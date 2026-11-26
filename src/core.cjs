"use strict";

const {ReadWindow} = require("./parallel-reads.cjs");
const {isNote,asText,notePlan} = require("./merge.cjs");

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const conflictFolder = "Homebound conflicts";
const idPattern = /^[0-9a-f]{32}$/;
const hashPattern = /^[0-9a-f]{64}$/;
const hex = bytes => Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, "0")).join("");
const randomId = () => hex(crypto.getRandomValues(new Uint8Array(16)));
const sha = async data => hex(await crypto.subtle.digest("SHA-256", data));
const jsonBytes = value => encoder.encode(JSON.stringify(value));
const parseBytes = bytes => JSON.parse(decoder.decode(bytes));

function safePath(path) {
    if (typeof path !== "string" || path.length === 0) return false;
    return path.split("/").every(part => part && !part.startsWith(".") &&
        !/[\\:*?"<>|\u0000-\u001f\u007f]/.test(part) && !/[ .]$/.test(part) &&
        !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part));
}

function directory(input) {
    const path = input.trim().replace(/^\/+|\/+$/g, "").normalize("NFC");
    if (!safePath(path)) throw Error("Enter a folder such as Notes/我的笔记. Use / between folder names.");
    return path;
}

function davAddress(input) {
    if (typeof input !== "string" || !input.trim()) throw Error("请填写 WebDAV HTTPS 地址。");
    let url;
    try { url = endpoint(input); } catch { throw Error("WebDAV 地址无效，请填写完整的 HTTPS 地址。"); }
    if (!url.startsWith("https://")) throw Error("WebDAV 地址必须使用 HTTPS。");
    return url;
}

function endpoint(input) {
    const url = new URL(input.trim());
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(loopback && url.protocol === "http:")) ||
        url.username || url.password || url.search || url.hash) {
        throw Error("Use an HTTPS WebDAV address without credentials, a query, or a fragment.");
    }
    return url.href.replace(/\/+$/, "");
}

const encodePath = path => path.split("/").map(encodeURIComponent).join("/");
const isRecovery = path => path.split("/")[0].toLowerCase() === conflictFolder.toLowerCase();

const generateKey = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const validKey = material => typeof material === "string" && hashPattern.test(material);

async function importKey(material) {
    if (!validKey(material)) throw Error("库密钥格式错误。");
    const bytes = Uint8Array.from(material.match(/../g), part => parseInt(part, 16));
    return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function seal(key, label, data) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(label) }, key, data);
    const result = new Uint8Array(12 + cipher.byteLength);
    result.set(iv);
    result.set(new Uint8Array(cipher), 12);
    return result.buffer;
}

async function unseal(key, label, data) {
    const bytes = new Uint8Array(data);
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12), additionalData: encoder.encode(label) },
        key, bytes.subarray(12));
}

const namespace = "homebound-v2";
const headerLabel = id => "homebound:2:" + id;

async function newHeader(material, id, previous = "") {
    const key = await importKey(material);
    const proof = hex(await seal(key, headerLabel(id), jsonBytes({id, previous})));
    return {format: 2, id, previous, proof};
}

async function unlock(header, material, pinned) {
    if (header?.format !== 2 || !idPattern.test(header.id) || header.id !== pinned ||
        !(header.previous === "" || idPattern.test(header.previous)) ||
        typeof header.proof !== "string" || !/^(?:[0-9a-f]{2}){28,180}$/.test(header.proof))
        throw Error("远端库标识或格式不匹配。请核对地址、目录和恢复密钥。");
    const key = await importKey(material);
    try {
        const packet = Uint8Array.from(header.proof.match(/../g), pair => parseInt(pair, 16));
        const proof = parseBytes(await unseal(key, headerLabel(pinned), packet));
        if (proof.id !== pinned || proof.previous !== header.previous) throw Error();
    } catch { throw Error("库密钥或远端库头校验失败。"); }
    return key;
}

function checkKnownIds(ids, visible) {
    let absent = 0;
    for (const id of ids) if (!visible.has(id)) absent++;
    if (absent) throw Error("Previously seen history is missing from this server. 远端缺少 " + absent + " 条已核对的提交。");
}

function checkRevision(id, rev) {
    if (rev.id !== id || !safePath(rev.path) || isRecovery(rev.path) ||
        !Array.isArray(rev.parents) || !rev.parents.every(p => idPattern.test(p)) ||
        !(rev.hash === null || hashPattern.test(rev.hash))) throw Error("Invalid revision metadata.");
}

// A revision is visible only after its immutable data and metadata have both arrived.
// MKCOL publishes a unique completion marker with a single WebDAV operation.
class Store {
    constructor(dav, id, key, transfer, knownIds = [], reads = new ReadWindow()) {
        this.transfer = transfer;
        this.knownIds = knownIds;
        this.reads = reads;
        this.dav = dav;
        this.id = id;
        this.key = key;
    }
    async readObject(name) {
        return unseal(this.key, this.id + "/" + name, await this.dav.read("objects/" + name));
    }
    async writeObject(name, bytes) {
        await this.dav.put("objects/" + name, await seal(this.key, this.id + "/" + name, bytes));
    }
    async publish(path, parents, bytes) {
        const hash = bytes === null ? null : await sha(bytes);
        const [rev] = await this.publishBatch([{path, parents, bytes, hash}], new ReadWindow(1));
        return rev;
    }
    // The caller groups whole files or supplies a single chunked attachment.
    // Finish each stage before publishing markers. A retry reuses the same object names.
    async publishBatch(files, window, published = () => {}, active = () => true) {
        const scope = "personal/" + this.id;
        const revisions = files.map(({path, parents, hash}) => ({id:randomId(), path, parents, hash, time:Date.now()}));
        const stage = work => window.each(files.length, async i => {
            if (!active()) throw Error("Sync stopped.");
            return work(revisions[i], files[i].bytes);
        });
        await stage(async (rev, bytes) => {
            if (this.transfer?.shouldSplit(bytes)) {
                if (files.length !== 1) throw Error("Chunked attachments require a separate batch.");
                Object.assign(rev, await this.transfer.upload({objects:this.chunkObjects(), scope, wrapKey:this.key,
                    path:rev.path, parents:rev.parents, hash:rev.hash, bytes, window}));
            } else if (bytes !== null) await this.writeObject("b-" + rev.id, bytes);
        });
        await stage(rev => this.writeObject("r-" + rev.id, jsonBytes(rev)));
        const attempted = new Set();
        await stage(async rev => {
            const retry = attempted.has(rev.id);
            attempted.add(rev.id);
            try { await this.dav.mkdir("commits/" + rev.id); }
            catch (error) {
                // MKCOL may have succeeded before a throttled response reached us.
                if (!retry || error.status !== 405 || !(await this.dav.list("commits")).includes(rev.id)) throw error;
            }
            this.lastPublished = rev.id;
            if (rev.parts) await this.transfer.uploaded(scope, rev.path);
            published(rev);
        });
        return revisions;
    }
    chunkObjects() {
        return {read:id=>this.dav.read("objects/b-"+id), put:(id,data)=>this.dav.put("objects/b-"+id,data)};
    }
    async readBody(rev,options) {
        if (rev.parts) {
            if (!this.transfer) throw Error("此附件需要支持分块的客户端。");
            return this.transfer.download(this.chunkObjects(),"personal/"+this.id,rev,{...options, reads:this.reads});
        }
        const bytes = await this.readObject("b-" + rev.id);
        if (await sha(bytes) !== rev.hash) throw Error("File integrity check failed: " + rev.path);
        return bytes;
    }
    async readMergeBase(rev) {
        try { return await this.readBody(rev); }
        catch (error) {
            if (error.status !== 404 || !(await this.readHistoryPolicy()).expired.includes(rev.id)) throw error;
            return null;
        }
    }
    async readHistoryPolicy(knownGeneration) {
        if (knownGeneration !== undefined) {
            // Slots are consecutive and never removed. Probe the next one without fetching a body.
            const next=await this.dav.call("HEAD","history-policy/v-"+(knownGeneration+1),[200,204,404,405,501],
                {headers:{"Cache-Control":"no-cache"}});
            if (next.status===404) return null;
        }
        // Publish numbered policy snapshots with the same no-overwrite MOVE used by vault setup.
        // Empty older slots remain reserved so a suspended writer can never publish into the past.
        for (let attempt=0;attempt<5;attempt++) {
            let entries;
            try { entries=await this.dav.list("history-policy"); }
            catch (error) { if (error.status!==404) throw error; entries=[]; }
            let generation=0;
            for (const name of entries) {
                if (/^stage-[a-f0-9]{32}$/.test(name)) continue;
                if (!/^v-[1-9]\d{0,12}$/.test(name)) throw Error("无法识别历史设置格式。");
                generation=Math.max(generation,Number(name.slice(2)));
            }
            if (generation===knownGeneration) return null;
            if (!generation) return {days:30,expired:[],pending:[],dates:{},generation:0};
            const packet=await this.dav.read("history-policy/v-"+generation);
            if (!packet.byteLength) continue; // A newer snapshot was published during this read.
            const value=parseBytes(await unseal(this.key,this.id+"/history-policy/"+generation,packet));
            if (![30,60,90,180,0].includes(value.days) || !Array.isArray(value.expired) ||
                !value.expired.every(id=>idPattern.test(id)) || !Array.isArray(value.pending) ||
                !value.pending.every(id=>idPattern.test(id)) || !value.dates || typeof value.dates!=="object" ||
                !Object.entries(value.dates).every(([id,t])=>idPattern.test(id) && Number.isSafeInteger(t) && t>0))
                throw Error("历史保留设置损坏，已停止处理历史版本。");
            return {...value,generation};
        }
        throw Error("历史设置读取期间已变化，请重试。");
    }
    async saveHistoryPolicy({generation,days,expired,pending,dates}) {
        if (!generation) {
            try { await this.dav.mkdir("history-policy"); }
            catch (error) { if (error.status!==405) throw error; }
        }
        const dir=this.dav.child("history-policy"), next=generation+1, stage="stage-"+randomId();
        const body=await seal(this.key,this.id+"/history-policy/"+next,jsonBytes({days,expired,pending,dates}));
        try {
            await dir.put(stage,body);
            const result=await dir.call("MOVE",stage,[201,412],{
                headers:{Destination:dir.child("v-"+next).root,Overwrite:"F"}
            });
            if (result.status===412) return false;
        } finally {
            // A timed-out MOVE may already have committed. Only discard this writer's own stage.
            await dir.call("DELETE",stage,[200,204,404]).catch(()=>{});
        }
        // The committed successor contains all prior decisions. Keep only a small reservation
        // at the old name; compaction is optional and never affects the new generation.
        if (generation) await dir.put("v-"+generation,new ArrayBuffer(0)).catch(()=>{});
        return true;
    }
    async history(cache, names, {progress, active = () => true, refresh = false} = {}) {
        names ??= await this.reads.one(() => this.dav.list("commits"));
        const visible = new Set(names);
        checkKnownIds(new Set([...this.knownIds, ...cache.keys()]), visible);
        const history = new Map(), missing = [];
        for (const id of visible) {
            if (!idPattern.test(id)) throw Error("Unexpected entry in the vault history.");
            const rev = refresh ? undefined : cache.get(id);
            if (rev) checkRevision(id, rev);
            else missing.push(id);
            // Preserve the listing order even when reads finish out of order.
            history.set(id, rev);
        }
        let checked = history.size - missing.length;
        progress?.("versions", checked, history.size);
        const read = async id => {
            if (!active()) throw Error("Sync stopped.");
            const rev = parseBytes(await this.readObject("r-" + id));
            checkRevision(id, rev);
            if (!active()) throw Error("Sync stopped.");
            history.set(id, rev);
            progress?.("versions", ++checked, history.size);
        };
        await this.reads.each(missing.length, i => read(missing[i]));
        if (!active()) throw Error("Sync stopped.");
        return history;
    }
}

function headsByPath(history) {
    const parents = new Set();
    const groups = new Map();
    for (const rev of history.values()) {
        for (const parent of rev.parents) {
            if (history.get(parent)?.path !== rev.path || parent === rev.id) throw Error("Incomplete revision history.");
            parents.add(parent);
        }
    }
    for (const rev of history.values()) {
        if (parents.has(rev.id)) continue;
        if (!groups.has(rev.path)) groups.set(rev.path, []);
        groups.get(rev.path).push(rev);
    }
    return groups;
}

function checkAliases(paths) {
    const names = new Map();
    const files = new Set(paths);
    for (const path of files) {
        const parts = path.split("/");
        for (let n = 1; n <= parts.length; n++) {
            const name = parts.slice(0, n).join("/");
            const key = name.normalize("NFC").toLowerCase();
            if ((names.has(key) && names.get(key) !== name) || (n < parts.length && files.has(name))) {
                throw Error("File or folder names collide on this device: " + name);
            }
            names.set(key, name);
        }
    }
}

async function syncScope(local, history) {
    const groups = headsByPath(history);
    const localPaths = local.paths();
    if (local.prepareCopies) {
        await local.prepareCopies(localPaths,history);
        for (const path of localPaths) if (local.isConflictCopy(path)) localPaths.delete(path);
        for (const path of groups.keys()) if (local.isConflictCopy(path)) groups.delete(path);
    }
    return {groups,localPaths};
}

// Only fast-forward a single remote head. All mutations still happen in path
// order and VaultFiles.apply checks the local hash again immediately before writing.
async function* prepareDownloads(paths, groups, baseline, localPaths, store, local, active, selection) {
    let batch = [];
    async function* flush() {
        await store.reads.each(batch.length, async i => {
            if (!active()) throw Error("Sync stopped.");
            const item = batch[i], previous = await local.read(item.path);
            const hash = previous === null ? null : await sha(previous);
            if (hash !== item.expected) return; // A concurrent local edit needs normal reconciliation.
            item.body = await store.readBody(item.head);
        });
        yield* batch;
        batch = [];
    }
    for (const path of paths) {
        const heads = groups.get(path), base = baseline.get(path);
        const expected = base?.hash ?? null, head = heads?.[0];
        if (path !== selection?.path && heads?.length === 1 && head.hash !== null && head.hash !== expected &&
            !head.parts && (base || !localPaths.has(path))) {
            batch.push({path, head, expected});
            if (batch.length >= store.reads.limit) yield* flush();
        } else {
            // In particular, assemble only one chunked attachment at a time.
            if (batch.length) yield* flush();
            yield {path};
        }
    }
    if (batch.length) yield* flush();
}

async function synchronize({ store, local, baseline, cache, checkpoint, resolve, selection, commitNames, progress, active = () => true }) {
    const history = await store.history(cache, commitNames, {progress, active});
    const {groups,localPaths} = await syncScope(local,history);
    if (selection && !groups.has(selection.path)) throw Error("冲突版本已变化，请重新同步并比较。");
    // A checkpoint from an earlier version may still contain a leaked conflict copy.
    let removedCopy = false;
    for (const path of baseline.keys()) if (local.isConflictCopy?.(path)) {
        baseline.delete(path);
        removedCopy = true;
    }
    if (removedCopy) checkpoint(baseline);
    // Every checkpoint must still be backed by a published revision on this server.
    for (const [path, base] of baseline) {
        if (!local.allowed(path) || !base.ids.length || base.ids.some(id =>
            history.get(id)?.path !== path || history.get(id).hash !== base.hash)) {
            throw Error("Local checkpoint does not match the remote history. Sync stopped.");
        }
    }
    const paths = new Set([...groups.keys(), ...localPaths, ...baseline.keys()]);
    for (const path of paths) {
        if (!safePath(path) || !local.allowed(path)) throw Error("Unsupported or reserved file path: " + path);
    }
    // Tombstones for old names must not block future unrelated paths.
    checkAliases([...paths].filter(path => localPaths.has(path) || groups.get(path)?.some(r => r.hash !== null)));
    const conflicts = [];
    let sent = 0, received = 0, processed = 0;
    progress?.("files", 0, paths.size);
    for await (const item of prepareDownloads(paths, groups, baseline, localPaths, store, local, active, selection)) {
        const {path} = item;
        if (!active()) throw Error("Sync stopped.");
        if (processed) progress?.("files", processed, paths.size);
        processed++;
        if (item.body !== undefined) {
            await local.apply(path, item.expected, item.body);
            baseline.set(path, {ids:[item.head.id], hash:item.head.hash});
            checkpoint(baseline);
            received++;
            continue;
        }
        let heads = groups.get(path) ?? [];
        let base = baseline.get(path);
        let bytes = await local.read(path);
        let hash = bytes === null ? null : await sha(bytes);
        const matching = heads.some(rev => rev.hash === hash);
        const changed = base ? hash !== base.hash : bytes !== null;
        const alreadySplit = new Set(heads.map(rev => rev.hash)).size > 1;
        const reviewing = selection?.path === path;
        if (reviewing) {
            const ids = heads.map(rev => rev.id).sort();
            if (!alreadySplit || hash !== selection.localHash ||
                JSON.stringify(ids) !== JSON.stringify(selection.headIds)) {
                throw Error("正文或冲突版本已变化，请重新同步并比较。");
            }
        }
        if (changed && !matching && (!alreadySplit || (!reviewing && resolve !== path))) {
            const parents = base?.ids ?? [];
            const rev = await store.publish(path, parents, bytes);
            history.set(rev.id, rev);
            heads = [...heads.filter(r => !parents.includes(r.id)), rev];
            sent++;
        }

        let appliedSelection = false;
        while (new Set(heads.map(rev => rev.hash)).size > 1) {
            // Remember which published branch the local file represents. Otherwise a peer
            // can re-upload its losing version as a new edit after someone resolves it.
            const matchingIds = heads.filter(rev => rev.hash === hash).map(rev => rev.id).sort();
            if (matchingIds.length && (bytes !== null || base) &&
                JSON.stringify(base?.ids) !== JSON.stringify(matchingIds)) {
                base = {ids:matchingIds,hash};
                baseline.set(path,base);
                checkpoint(baseline);
            }
            const manual = reviewing && !appliedSelection;
            let chosen = bytes, parents = heads;
            if (!manual && (resolve !== path || bytes === null)) {
                // A new or lagging client may not hold either head. Compare two
                // actual branches, then apply against the bytes this client read.
                const ordered = heads.slice().sort((a,b) => a.id.localeCompare(b.id));
                const left = ordered.find(r=>r.hash===hash) || ordered[0];
                const right = ordered.find(r=>r.hash!==left.hash);
                let plan = null;
                if (isNote(path) && left.hash!==null && right.hash!==null) {
                    const leftText = asText(left.hash===hash ? bytes : await store.readBody(left));
                    const rightText = asText(await store.readBody(right));
                    plan = await notePlan(history,heads,left.hash,right.hash,leftText,rightText,r=>store.readMergeBase(r));
                }
                if (!plan || plan.some(part=>typeof part!=="string")) {
                    for (const rev of heads) {
                        if (rev.hash!==null) await local.archive(rev,()=>store.readBody(rev));
                    }
                    if ((!base && bytes===null) || (!matchingIds.length && (!base || base.hash===hash))) {
                        const candidate=ordered.find(r=>r.hash!==null);
                        await local.apply(path,hash,await store.readBody(candidate));
                        baseline.set(path,{ids:heads.filter(r=>r.hash===candidate.hash).map(r=>r.id).sort(),hash:candidate.hash});
                        checkpoint(baseline);
                    }
                    conflicts.push(path);
                    break;
                }
                parents = heads.filter(r=>r.hash===left.hash || r.hash===right.hash);
                chosen = encoder.encode(plan.join("")).buffer;
            } else if (manual) {
                // A choice only resolves the two branches displayed in this review.
                if (selection.peerId || selection.source === "merge") {
                    const peer = heads.find(rev => rev.id === selection.peerId);
                    if (!peer) throw Error("所选副本已变化，请重新比较。");
                    parents = heads.filter(rev => rev.hash === hash || rev.hash === peer.hash);
                }
                if (selection.source === "merge") {
                    if (typeof selection.text !== "string") throw Error("缺少合并正文。");
                    chosen = encoder.encode(selection.text).buffer;
                } else if (selection.source !== "local") {
                    const source = heads.find(rev => rev.id === selection.source);
                    if (!source || (selection.peerId && source.id !== selection.peerId)) throw Error("所选副本已变化，请重新比较。");
                    if (source.hash !== hash) chosen = source.hash === null ? null : await store.readBody(source);
                }
            }
            const current = await local.read(path);
            if ((current === null ? null : await sha(current)) !== hash)
                throw Error("比较期间正文已变化，请重新比较。");
            if (!active()) throw Error("Sync stopped.");
            const parentIds = parents.map(r => r.id);
            const rev = await store.publish(path, parentIds, chosen);
            // A failed publish leaves the local file and the editable draft intact.
            // apply checks the expected bytes again in case an edit raced the upload.
            if (rev.hash !== hash) {
                if (!active()) throw Error("Sync stopped.");
                await local.apply(path,hash,chosen);
                hash = rev.hash;
                bytes = chosen;
            }
            history.set(rev.id, rev);
            heads = [rev, ...heads.filter(head => !parentIds.includes(head.id))];
            sent++;
            appliedSelection = appliedSelection || manual;
        }
        if (new Set(heads.map(rev=>rev.hash)).size>1) continue;
        if (!heads.length) continue;
        const target = heads[0];
        if (target.hash !== hash) {
            const content = target.hash === null ? null : await store.readBody(target);
            await local.apply(path, hash, content);
            received++;
        }
        const next = { ids: heads.map(r => r.id).sort(), hash: target.hash };
        if (!base || JSON.stringify(base) !== JSON.stringify(next)) {
            baseline.set(path, next);
            checkpoint(baseline);
        }
    }
    if (paths.size) progress?.("files", paths.size, paths.size);
    return { history, sent, received, conflicts };
}

async function createVault(home, folder, material, id, previous = "", window = new ReadWindow(1)) {
    let current = home;
    for (const part of folder.split("/")) {
        try { await window.one(() => current.mkdir(part)); }
        catch (e) { if (e.status !== 405) throw e; }
        current = current.child(part);
    }
    const entries = await window.one(() => current.list());
    if (entries.includes(namespace)) {
        const existing = parseBytes(await window.one(() => current.child(namespace).read("vault.json")));
        await unlock(existing, material, id);
        if (existing.previous !== previous) throw Error("目标目录已绑定其他库。");
        return existing;
    }
    if (entries.some(name => !/^homebound-init-[0-9a-f]{32}$/.test(name))) {
        throw Error("Please choose an empty remote folder, or connect the existing vault. 请选择空目录，或连接已有库。");
    }
    const header = await newHeader(material, id, previous);
    const staging = "homebound-init-" + randomId();
    // An overloaded server may already have created this exact staging directory.
    async function makeStageDirectory(parent, name) {
        let attempted = false;
        await window.one(async () => {
            const retry = attempted;
            attempted = true;
            try { await parent.mkdir(name); }
            catch (error) {
                if (!retry || error.status !== 405) throw error;
                await parent.list(name);
            }
        });
    }
    await makeStageDirectory(current, staging);
    const store = current.child(staging);
    await makeStageDirectory(store, "objects");
    await makeStageDirectory(store, "commits");
    await window.one(() => store.put("vault.json", jsonBytes(header).buffer));
    // A dropped connection leaves an unpublished staging directory. Retrying cannot replace a live vault.
    try {
        await window.one(() => current.call("MOVE", staging, [201], { headers: { Destination: current.child(namespace).root, Overwrite: "F" } }));
    } catch (error) {
        let existing;
        try { existing = parseBytes(await window.one(() => current.child(namespace).read("vault.json"))); } catch { /* Preserve the original failure. */ }
        if (existing?.id !== header.id) throw error;
        await unlock(existing, material, id);
        if (existing.previous !== previous) throw error;
    }
    return header;
}

module.exports = { createVault, Store, synchronize, syncScope, headsByPath, safePath, isRecovery, conflictFolder, directory, endpoint, davAddress, encodePath,
    namespace, newHeader, unlock, importKey, validKey, checkRevision, checkKnownIds, generateKey, checkAliases, randomId, sha, jsonBytes, parseBytes, seal, unseal };
