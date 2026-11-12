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

async function derive(passphrase, salt) {
    const material = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
    const bytes = Uint8Array.from(salt.match(/../g), pair => parseInt(pair, 16));
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: bytes, iterations: 600000 },
        material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
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

async function newHeader(passphrase) {
    const id = randomId();
    const salt = randomId();
    const key = await derive(passphrase, salt);
    const proof = hex(await seal(key, "homebound:1:" + id, encoder.encode("vault")));
    return { format: 1, id, salt, proof };
}

async function unlock(header, passphrase, pinned) {
    if (header?.format !== 1 || !idPattern.test(header.id) || !idPattern.test(header.salt) ||
        !/^[0-9a-f]{66}$/.test(header.proof)) throw Error("Unrecognized WebDAV vault header.");
    if (pinned && pinned !== header.id) throw Error("This address leads to a different vault. Check both routes.");
    const key = await derive(passphrase, header.salt);
    try {
        const proof = Uint8Array.from(header.proof.match(/../g), pair => parseInt(pair, 16));
        if (decoder.decode(await unseal(key, "homebound:1:" + header.id, proof)) !== "vault") throw Error();
    } catch { throw Error("Vault passphrase or authenticated header is incorrect."); }
    return key;
}

// A revision is visible only after its immutable data and metadata have both arrived.
// MKCOL publishes a unique completion marker with a single WebDAV operation.
class Store {
    constructor(dav, id, key) {
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
        const id = randomId();
        const hash = bytes === null ? null : await sha(bytes);
        if (bytes !== null) await this.writeObject("b-" + id, bytes);
        const rev = { id, path, parents, hash };
        await this.writeObject("r-" + id, jsonBytes(rev));
        await this.dav.mkdir("commits/" + id);
        return rev;
    }
    async readBody(rev) {
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

async function synchronize({ store, local, baseline, cache, checkpoint, resolve, active = () => true }) {
    const history = await store.history(cache);
    const groups = headsByPath(history);
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
        const hash = bytes === null ? null : await sha(bytes);
        const matching = heads.some(rev => rev.hash === hash);
        const changed = base ? hash !== base.hash : bytes !== null;
        const alreadySplit = new Set(heads.map(rev => rev.hash)).size > 1;
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
            if (resolve !== path || bytes === null) {
                // Give a device with an empty vault a file it can open to resolve the dispute.
                if (!base && bytes === null) {
                    const candidate = heads.filter(r => r.hash !== null).sort((a,b) => a.id.localeCompare(b.id))[0];
                    if (candidate) await local.apply(path, null, await store.readBody(candidate));
                }
                conflicts.push(path);
                continue;
            }
            const rev = await store.publish(path, heads.map(r => r.id), bytes);
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

async function createVault(home, folder, passphrase, namespace) {
    let current = home;
    for (const part of folder.split("/")) {
        try { await current.mkdir(part); }
        catch (e) { if (e.status !== 405) throw e; }
        current = current.child(part);
    }
    const entries = await current.list();
    if (entries.some(name => !/^homebound-init-[0-9a-f]{32}$/.test(name))) {
        throw Error("Please choose an empty remote folder, or connect the existing vault. 请选择空目录，或连接已有库。");
    }
    const header = await newHeader(passphrase);
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
    }
    return header;
}

module.exports = { createVault, Store, synchronize, safePath, isRecovery, conflictFolder, directory, endpoint, encodePath,
    newHeader, unlock, randomId, sha, jsonBytes, parseBytes };
