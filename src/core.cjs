"use strict";

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

async function importKey(material) {
    if (typeof material !== "string" || !/^[a-f0-9]{64}$/.test(material)) throw Error("库密钥格式错误。");
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

// A revision is visible only after its immutable data and metadata have both arrived.
// MKCOL publishes a unique completion marker with a single WebDAV operation.
class Store {
    constructor(dav, id, key, transfer) {
        this.transfer = transfer;
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
        const scope = "personal/" + this.id;
        const staged = this.transfer?.shouldSplit(bytes) ? await this.transfer.upload({
            objects:this.chunkObjects(), scope, wrapKey:this.key, path, parents, hash, bytes
        }) : null;
        const id = staged?.id || randomId();
        if (bytes !== null && !staged) await this.writeObject("b-" + id, bytes);
        const rev = { id, path, parents, hash };
        if (staged) Object.assign(rev, {parts:staged.parts, key:staged.key});
        await this.writeObject("r-" + id, jsonBytes(rev));
        await this.dav.mkdir("commits/" + id);
        if (staged) await this.transfer.uploaded(scope,path);
        return rev;
    }
    chunkObjects() {
        return {read:id=>this.dav.read("objects/b-"+id), put:(id,data)=>this.dav.put("objects/b-"+id,data)};
    }
    async readBody(rev,options) {
        if (rev.parts) {
            if (!this.transfer) throw Error("此附件需要支持分块的客户端。");
            return this.transfer.download(this.chunkObjects(),"personal/"+this.id,rev,options);
        }
        const bytes = await this.readObject("b-" + rev.id);
        if (await sha(bytes) !== rev.hash) throw Error("File integrity check failed: " + rev.path);
        return bytes;
    }
    async history(cache) {
        const names = await this.dav.list("commits");
        const visible = new Set(names);
        for (const id of cache.keys()) {
            if (!visible.has(id)) throw Error("Previously seen history is missing from this server.");
        }
        const history = new Map();
        for (const id of visible) {
            if (!idPattern.test(id)) throw Error("Unexpected entry in the vault history.");
            const rev = cache.get(id) ?? parseBytes(await this.readObject("r-" + id));
            if (rev.id !== id || !safePath(rev.path) || isRecovery(rev.path) ||
                !Array.isArray(rev.parents) || !rev.parents.every(p => idPattern.test(p)) ||
                !(rev.hash === null || hashPattern.test(rev.hash))) throw Error("Invalid revision metadata.");
            history.set(id, rev);
        }
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

async function synchronize({ store, local, baseline, cache, checkpoint, resolve, selection, active = () => true }) {
    const history = await store.history(cache);
    const groups = headsByPath(history);
    if (selection && !groups.has(selection.path)) throw Error("冲突版本已变化，请重新同步并比较。");
    const localPaths = local.paths();
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
    let sent = 0, received = 0;
    for (const path of paths) {
        if (!active()) throw Error("Sync stopped.");
        let heads = groups.get(path) ?? [];
        const base = baseline.get(path);
        const bytes = await local.read(path);
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
        if (changed && !matching && !alreadySplit) {
            const parents = base?.ids ?? [];
            const rev = await store.publish(path, parents, bytes);
            history.set(rev.id, rev);
            heads = [...heads.filter(r => !parents.includes(r.id)), rev];
            sent++;
        }

        if (new Set(heads.map(rev => rev.hash)).size > 1) {
            for (const rev of heads) {
                if (rev.hash !== null) await local.archive(rev, () => store.readBody(rev));
            }
            // Remember which published branch the local file represents. Otherwise a peer
            // can re-upload its losing version as a new edit after someone resolves it.
            const matchingIds = heads.filter(rev => rev.hash === hash).map(rev => rev.id).sort();
            if (matchingIds.length && (bytes !== null || base) &&
                JSON.stringify(base?.ids) !== JSON.stringify(matchingIds)) {
                baseline.set(path, { ids: matchingIds, hash });
                checkpoint(baseline);
            }
            if (!reviewing && (resolve !== path || bytes === null)) {
                // Give a device with an empty vault a file it can open to resolve the dispute.
                if (!base && bytes === null) {
                    const candidate = heads.filter(r => r.hash !== null).sort((a,b) => a.id.localeCompare(b.id))[0];
                    if (candidate) {
                        await local.apply(path, null, await store.readBody(candidate));
                        baseline.set(path, { ids: [candidate.id], hash: candidate.hash });
                        checkpoint(baseline);
                    }
                }
                conflicts.push(path);
                continue;
            }
            let chosen = bytes;
            if (reviewing && selection.source !== "local") {
                const source = heads.find(rev => rev.id === selection.source);
                if (!source) throw Error("所选副本已变化，请重新比较。");
                if (source.hash !== hash) {
                    chosen = source.hash === null ? null : await store.readBody(source);
                    await local.apply(path, hash, chosen);
                    hash = source.hash;
                }
            }
            if (!active()) throw Error("Sync stopped.");
            const rev = await store.publish(path, heads.map(r => r.id), chosen);
            history.set(rev.id, rev);
            heads = [rev];
            sent++;
        }
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
    return { history, sent, received, conflicts };
}

async function createVault(home, folder, material, id, previous = "") {
    let current = home;
    for (const part of folder.split("/")) {
        try { await current.mkdir(part); }
        catch (e) { if (e.status !== 405) throw e; }
        current = current.child(part);
    }
    const entries = await current.list();
    if (entries.includes(namespace)) {
        const existing = parseBytes(await current.child(namespace).read("vault.json"));
        await unlock(existing, material, id);
        if (existing.previous !== previous) throw Error("目标目录已绑定其他库。");
        return existing;
    }
    if (entries.some(name => !/^homebound-init-[0-9a-f]{32}$/.test(name))) {
        throw Error("Please choose an empty remote folder, or connect the existing vault. 请选择空目录，或连接已有库。");
    }
    const header = await newHeader(material, id, previous);
    const staging = "homebound-init-" + randomId();
    await current.mkdir(staging);
    const store = current.child(staging);
    await store.mkdir("objects");
    await store.mkdir("commits");
    await store.put("vault.json", jsonBytes(header).buffer);
    // A dropped connection leaves an unpublished staging directory. Retrying cannot replace a live vault.
    try {
        await current.call("MOVE", staging, [201], { headers: { Destination: current.child(namespace).root, Overwrite: "F" } });
    } catch (error) {
        let existing;
        try { existing = parseBytes(await current.child(namespace).read("vault.json")); } catch { /* Preserve the original failure. */ }
        if (existing?.id !== header.id) throw error;
        await unlock(existing, material, id);
        if (existing.previous !== previous) throw error;
    }
    return header;
}

module.exports = { createVault, Store, synchronize, headsByPath, safePath, isRecovery, conflictFolder, directory, endpoint, davAddress, encodePath,
    namespace, newHeader, unlock, generateKey, checkAliases, randomId, sha, jsonBytes, parseBytes, seal, unseal };
