"use strict";

const {ReadWindow, limited} = require("./parallel-reads.cjs");
const core = require("./core.cjs");

const blockSize = 512 * 1024;
const threshold = 4 * 1024 * 1024;
const retention = 7 * 24 * 60 * 60 * 1000;
const encoder = new TextEncoder();
const base64 = bytes => btoa(String.fromCharCode(...bytes));
const from64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
const aes = bytes => crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);

class TransferCache {
    constructor(localId) { this.localId = localId; }
    async database() {
        if (!this.opening) {
            this.opening = new Promise((resolve, reject) => {
                const req = indexedDB.open("homebound-transfer-" + this.localId, 1);
                req.onupgradeneeded = () => req.result.createObjectStore("parts").createIndex("updated", "updated");
                req.onerror = () => { this.opening = null; reject(req.error); };
                req.onsuccess = () => {
                    const db = req.result;
                    db.onversionchange = () => { db.close(); this.opening = null; };
                    const tx = db.transaction("parts", "readwrite");
                    const old = tx.objectStore("parts").index("updated").openCursor(IDBKeyRange.upperBound(Date.now() - retention));
                    old.onsuccess = () => { const c = old.result; if (c) { c.delete(); c.continue(); } };
                    tx.oncomplete = () => resolve(db);
                    tx.onabort = () => { db.close(); this.opening = null; reject(tx.error); };
                };
            });
        }
        return this.opening;
    }
    async run(mode, operation) {
        const db = await this.database();
        return new Promise((resolve, reject) => {
            const tx = db.transaction("parts", mode);
            const req = operation(tx.objectStore("parts"));
            tx.oncomplete = () => resolve(req.result);
            tx.onabort = () => reject(tx.error || Error("无法保存分块传输进度。"));
        });
    }
    async get(key) { return (await this.run("readonly", store => store.get(key)))?.value; }
    put(key,value) { return this.run("readwrite", store => store.put({value,updated:Date.now()},key)); }
    remove(key) { return this.run("readwrite", store => store.delete(key)); }
    clearDownload(scope,id) {
        return this.remove(IDBKeyRange.bound([scope,"get",id,0], [scope,"get",id,Number.MAX_SAFE_INTEGER]));
    }
}

function validParts(parts) {
    return parts?.v === 1 && Number.isSafeInteger(parts.size) && parts.size >= threshold &&
        parts.size <= 0xffffffff && /^[a-f0-9]{32}$/.test(parts.seed);
}
function transient(e) {
    return e.offline || [408,425,429,500,502,503,504].includes(e.status);
}
function chunkName(parts, i) {
    return core.sha(encoder.encode("homebound-chunk-1/" + parts.seed + "/" + i)).then(h => h.slice(0,32));
}
function label(scope, id, parts, i) {
    return JSON.stringify(["homebound-chunk-1",scope,id,parts.seed,parts.size,i]);
}

class ChunkTransfer {
    constructor(cache, {enabled=false, progress=()=>{}, active=()=>true, wait=ms=>new Promise(r=>setTimeout(r,ms))} = {}) {
        this.cache=cache; this.enabled=enabled; this.progress=progress; this.active=active; this.wait=wait;
    }
    shouldSplit(bytes) { return this.enabled && bytes?.byteLength >= threshold; }
    checkActive() { if (!this.active()) throw Error("传输已停止。"); }
    async retry(info, operation, reads) {
        for (let attempt=0;;attempt++) {
            this.checkActive();
            try { return await operation(attempt); }
            catch (e) {
                if (!transient(e) || (reads?.limit > 1 && limited(e))) throw e;
                if (attempt >= 3) {
                    throw Object.assign(Error(e.message + " · 已保留分块进度，可重新同步。"), {status:e.status, offline:e.offline});
                }
                this.progress({...info,retry:attempt+1});
                await this.wait(500 * 2 ** attempt);
            }
        }
    }
    async upload({objects,scope,wrapKey,path,parents,hash,bytes}) {
        const data = new Uint8Array(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.byteLength);
        const slot = [scope,"put",path];
        const binding = JSON.stringify(["upload-2",scope,path,hash,[...parents].sort()]);
        let pending = await this.cache.get(slot);
        let raw;
        if (pending?.binding === binding) {
            raw = await core.unseal(wrapKey,binding,pending.wrapped);
        } else {
            raw = crypto.getRandomValues(new Uint8Array(32));
            pending = {binding,id:core.randomId(),parts:{v:1,size:data.length,seed:core.randomId()},done:0,inFlight:false,
                wrapped:await core.seal(wrapKey,binding,raw)};
            await this.cache.put(slot,pending);
        }
        const {id,parts} = pending, total = Math.ceil(data.length / blockSize);
        if (!validParts(parts) || parts.size !== data.length || !Number.isInteger(pending.done) ||
            pending.done < 0 || pending.done > total) throw Error("分块上传记录损坏。");
        const key = await aes(raw);
        const info = {direction:"upload",path,total,size:data.length,done:pending.done};
        this.progress(info);
        for (let i=pending.done;i<total;i++) {
            this.checkActive();
            const chunk = data.subarray(i*blockSize,(i+1)*blockSize);
            const name = await chunkName(parts,i), aad = label(scope,id,parts,i);
            const uncertain = pending.inFlight;
            pending.inFlight = true;
            await this.cache.put(slot,pending);
            await this.retry(info, async attempt => {
                // A timeout may occur after the server saved the PUT. Authenticate that block before skipping it.
                if (uncertain || attempt > 0) {
                    let packet;
                    try { packet = await objects.read(name); } catch (e) { if (e.status !== 404) throw e; }
                    if (packet) {
                        const old = new Uint8Array(await core.unseal(key,aad,packet));
                        if (old.length !== chunk.length || !old.every((b,j)=>b===chunk[j])) throw Error("远端分块内容不一致。");
                        return;
                    }
                }
                await objects.put(name,await core.seal(key,aad,chunk));
            });
            pending.done = ++info.done; pending.inFlight = false;
            await this.cache.put(slot,pending);
            this.progress(info);
        }
        this.checkActive();
        return {id,parts,key:base64(new Uint8Array(raw))};
    }
    async download(objects,scope,rev,{audit=false, reads = new ReadWindow()} = {}) {
        const {parts,id,path}=rev;
        if (!validParts(parts)) throw Error("无法识别附件分块格式。");
        const total = Math.ceil(parts.size/blockSize), key = await aes(from64(rev.key));
        let output;
        const info = {direction:"download",path,total,size:parts.size,done:0};
        this.progress(info);
        await reads.each(total, async i => {
            this.checkActive();
            const slot = [scope,"get",id,i], aad = label(scope,id,parts,i);
            // Recovery audits must verify every remote object even after an interrupted download.
            let packet = audit ? undefined : await this.cache.get(slot), clear;
            if (packet) {
                try { clear = await core.unseal(key,aad,packet); }
                catch { await this.cache.remove(slot); }
            }
            if (!clear) {
                const name = await chunkName(parts,i);
                packet = await this.retry(info, () => objects.read(name), reads);
                clear = await core.unseal(key,aad,packet);
                if (!audit) await this.cache.put(slot,packet);
            }
            const expected = Math.min(blockSize,parts.size-i*blockSize);
            if (clear.byteLength !== expected) throw Error("附件分块长度不一致。");
            // Allocate only after authenticating the declared size in a block's additional data.
            if (!output) output = new Uint8Array(parts.size);
            output.set(new Uint8Array(clear),i*blockSize);
            info.done++; this.progress(info);
        });
        if (await core.sha(output) !== rev.hash) throw Error("附件完整性检查失败：" + path);
        if (!audit) await this.cache.clearDownload(scope,id);
        return output.buffer;
    }
    uploaded(scope,path) { return this.cache.remove([scope,"put",path]); }
}
module.exports = {ChunkTransfer,TransferCache,blockSize,threshold,validParts,chunkName};
