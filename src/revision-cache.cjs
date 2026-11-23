"use strict";

const core = require("./core.cjs");
const token = /^[0-9a-f]{32}$/;
const pointerKey = id => "homebound-revision-cache-v1-" + id;
const label = (id, generation) => "homebound:revision-cache:1:" + id + ":" + generation;
const knownIds = pointer => (Array.isArray(pointer?.ids) ? pointer.ids : [])
    .filter(value => typeof value === "string" && token.test(value));

class RevisionCache {
    constructor(app, directory) {
        this.app = app;
        this.disk = app.vault.adapter;
        this.directory = directory;
        this.loaded = null;
    }

    path(id, generation) {
        if (!token.test(id) || !token.test(generation)) throw Error("Invalid version cache identifier.");
        return this.directory + "/versions-" + id + "-" + generation + ".bin";
    }

    knownIds(id) { return knownIds(this.app.loadLocalStorage(pointerKey(id))); }

    async load(id, material) {
        this.loaded = null;
        const pointer = this.app.loadLocalStorage(pointerKey(id));
        if (!pointer) return new Map();
        // Keep the known IDs independently so an unreadable snapshot cannot
        // turn a rolled-back remote listing into an apparently new vault.
        const known = new Set(knownIds(pointer));
        try {
            const packet = await this.disk.readBinary(this.path(id, pointer.generation));
            const key = await core.importKey(material);
            const entries = core.parseBytes(await core.unseal(key, label(id, pointer.generation), packet));
            if (!Array.isArray(entries) || entries.length !== known.size) return new Map();
            const verified = new Map();
            for (const rev of entries) {
                if (!known.has(rev.id) || verified.has(rev.id)) return new Map();
                core.checkRevision(rev.id, rev);
                verified.set(rev.id, rev);
            }
            this.loaded = pointer.generation;
            return verified;
        } catch { return new Map(); }
    }

    async save(store, history, active, force = false) {
        const id = store.id, key = pointerKey(id);
        const previous = this.app.loadLocalStorage(key);
        const ids = knownIds(previous);
        core.checkKnownIds(ids, history);
        if (!force && token.test(previous?.generation) && this.loaded === previous.generation && ids.length === history.size) return;
        const generation = core.randomId(), path = this.path(id, generation);
        const packet = await core.seal(store.key, label(id, generation), core.jsonBytes([...history.values()]));
        try {
            await this.disk.writeBinary(path, packet);
            const stored = new Uint8Array(await this.disk.readBinary(path)), expected = new Uint8Array(packet);
            if (stored.length !== expected.length || !stored.every((value,i) => value === expected[i]))
                throw Error("本机版本缓存写入校验失败。");
            if (!active()) throw Error("版本缓存重建已中止。");
            if (this.app.loadLocalStorage(key)?.generation !== previous?.generation)
                throw Error("本机版本缓存已变化，请重试。");
            // The old snapshot remains the selected one until the new file is complete.
            this.app.saveLocalStorage(key, {generation, ids:[...history.keys()]});
        } catch (error) {
            await this.disk.remove(path).catch(() => {});
            throw error;
        }
        this.loaded = generation;
        if (token.test(previous?.generation)) await this.disk.remove(this.path(id, previous.generation)).catch(() => {});
    }
}

module.exports = {RevisionCache};
