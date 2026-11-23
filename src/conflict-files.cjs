"use strict";

const {conflictFolder, safePath, isRecovery, sha} = require("./core.cjs");
const revisionDir = /^([0-9a-f]{32})-([0-9a-f]{64})$/;
const siblingSuffix = /-(\d{14})-conflict-([0-9a-f]{32})(?:-([1-9]\d*))?(?:\.[^/.]*)?$/;
const encoder = new TextEncoder();

function stamp(date) {
    return [date.getFullYear(), date.getMonth()+1, date.getDate(), date.getHours(), date.getMinutes(),
        date.getSeconds()].map(n => String(n).padStart(2,"0")).join("");
}

function fitBytes(text,room) {
    let result = "";
    for (const ch of text) {
        room -= encoder.encode(ch).length;
        if (room < 0) break;
        result += ch;
    }
    return result;
}

function siblingPath({path, id, time, number}) {
    const slash = path.lastIndexOf("/"), name = path.slice(slash+1), dot = name.lastIndexOf(".");
    const suffix = "-" + time + "-conflict-" + id + (number ? "-" + number : "");
    const room = 255 - suffix.length;
    // Leave space for at least one Unicode character from the original name.
    const ext = dot < 0 ? "" : fitBytes(name.slice(dot),room-4);
    const stem = fitBytes(dot < 0 ? name : name.slice(0,dot),room-encoder.encode(ext).length);
    return path.slice(0,slash+1) + stem + suffix + ext;
}

class ConflictFiles {
    constructor(app, pluginDir) {
        this.app = app;
        this.disk = app.vault.adapter;
        this.root = pluginDir + "/conflicts";
        this.markers = this.root + "/deferred";
        this.copies = new Map();
        this.paths = new Set();
        this.legacyUploads = new Set();
        this.work = Promise.resolve();
    }
    serial(action) {
        const result = this.work.then(action);
        this.work = result.catch(() => {});
        return result;
    }
    key(rev) { return rev.id + "-" + rev.hash; }
    archivePath(rev) { return this.root + "/" + this.key(rev) + "/" + rev.path; }
    marker(rev) { return this.markers + "/" + this.key(rev) + ".json"; }
    track(record) {
        this.copies.set(record.id,record);
        this.paths.add(siblingPath(record));
    }
    async load() {
        if (!await this.disk.exists(this.markers)) return;
        for (const file of (await this.disk.list(this.markers)).files) {
            const name = file.slice(this.markers.length+1);
            const match = name.endsWith(".json") && revisionDir.exec(name.slice(0,-5));
            if (!match) continue;
            const record = JSON.parse(await this.disk.read(file));
            if (!safePath(record.path) || isRecovery(record.path) || typeof record.time !== "string" ||
                !/^\d{14}$/.test(record.time) || !Number.isSafeInteger(record.number) || record.number < 0)
                throw Error("Invalid conflict copy record: " + file);
            this.track({...record,id:match[1],hash:match[2]});
        }
    }
    excludes(path) { return this.paths.has(path) || this.legacyUploads.has(path); }
    async prepare(paths, history) {
        // A previous plugin instance may finish writing its marker after our startup load.
        // Snapshot the candidate names first. A sibling created later waits for the next scan.
        for (const path of paths) {
            if (!this.excludes(path) && siblingSuffix.test(path)) {
                await this.serial(() => this.load());
                break;
            }
        }
        // Older versions could publish a deferred copy. Recognize its original upload by
        // authenticated source revision, generated path and matching bytes. Preserve the ledger.
        for (const rev of history.values()) {
            if (rev.parents.length || !rev.hash || this.legacyUploads.has(rev.path)) continue;
            const match = siblingSuffix.exec(rev.path);
            if (!match) continue;
            const source = history.get(match[2]);
            if (source?.hash === rev.hash && siblingPath({...source,time:match[1],number:Number(match[3] || 0)}) === rev.path)
                this.legacyUploads.add(rev.path);
        }
    }
    async ensureDir(path) {
        if (await this.disk.exists(path)) return;
        const parent = path.lastIndexOf("/");
        if (parent >= 0) await this.ensureDir(path.slice(0,parent));
        try { await this.disk.mkdir(path); }
        catch (error) { if ((await this.disk.stat(path))?.type !== "folder") throw error; }
    }
    async read(rev) {
        const path = this.archivePath(rev);
        if (!await this.disk.exists(path)) return null;
        const bytes = await this.disk.readBinary(path);
        return await sha(bytes) === rev.hash ? bytes : null;
    }
    async archive(rev, body) {
        if (await this.read(rev) !== null) return;
        const path = this.archivePath(rev), bytes = await body();
        if (await sha(bytes) !== rev.hash) throw Error("Invalid conflict copy: " + rev.path);
        if (await this.disk.exists(path)) throw Error("Move the modified conflict archive before syncing: " + path);
        await this.ensureDir(path.slice(0,path.lastIndexOf("/")));
        const partial = this.root + "/" + this.key(rev) + "/.partial";
        await this.disk.writeBinary(partial,bytes);
        await this.disk.rename(partial,path);
    }
    defer(rev, local, history, headIds = [rev.id]) {
        return this.serial(async () => {
            let record = [...this.copies.values()].find(r => r.path === rev.path && headIds.includes(r.id));
            if (!record) {
                record = {id:rev.id,hash:rev.hash,path:rev.path,time:stamp(new Date()),number:0};
                const known = new Set(Array.from(history.values(),r => r.path.normalize("NFC").toLowerCase()));
                while (await this.disk.exists(siblingPath(record)) || known.has(siblingPath(record).normalize("NFC").toLowerCase()))
                    record.number++;
                // Publish the ownership record before a visible vault event can queue an upload.
                await this.ensureDir(this.markers);
                const marker = this.marker(record);
                await this.disk.write(marker+".tmp",JSON.stringify(record));
                await this.disk.rename(marker+".tmp",marker);
                this.track(record);
            }
            await this.materialize(record,local);
        });
    }
    async materialize(record,local) {
        const path = siblingPath(record);
        if (await this.disk.exists(path)) return;
        const bytes = await this.read(record);
        if (bytes === null) throw Error("Missing conflict copy: " + record.path);
        await local.apply(path,null,bytes);
    }
    async removeSibling(record) {
        const path = siblingPath(record);
        if (await this.disk.exists(path)) {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (!file || file.children || await sha(await this.app.vault.readBinary(file)) !== record.hash || file.path !== path)
                return false;
            await this.app.fileManager.trashFile(file);
        }
        await this.disk.remove(this.marker(record));
        this.paths.delete(path);
        this.copies.delete(record.id);
        return true;
    }
    async trashEmpty(dir) {
        const {files,folders} = await this.disk.list(dir);
        if (files.length || folders.length) return false;
        // Obsidian's desktop adapter cannot rmdir a directory non-recursively on all platforms.
        await this.disk.trashLocal(dir);
        return true;
    }
    async prune(dir,root) {
        while (dir===root || dir.startsWith(root+"/")) {
            if (!await this.trashEmpty(dir)) break;
            dir = dir.slice(0,dir.lastIndexOf("/"));
        }
    }
    async migrateLegacy(history) {
        const folder = this.app.vault.getAbstractFileByPath(conflictFolder);
        if (!folder?.children) return 0;
        let edited = 0;
        const visit = async dir => {
            for (const file of [...dir.children]) {
                if (file.children) { await visit(file); continue; }
                const [id,...parts] = file.path.slice(conflictFolder.length+1).split("/");
                const rev = history.get(id);
                if (!rev?.hash || rev.path !== parts.join("/")) continue;
                const bytes = await this.app.vault.readBinary(file);
                if (await sha(bytes) !== rev.hash) { edited++; continue; }
                await this.archive(rev,() => bytes);
                if (await sha(await this.app.vault.readBinary(file)) !== rev.hash || file.path !== conflictFolder+"/"+id+"/"+rev.path)
                    continue;
                const parent = file.parent.path;
                await this.app.fileManager.trashFile(file);
                await this.prune(parent,conflictFolder);
            }
        };
        await visit(folder);
        return edited;
    }
    async reconcile(local,history,versions) {
        await this.migrateLegacy(history);
        for (const record of this.copies.values()) {
            if (versions.get(record.path)?.split(",").includes(record.id)) await this.materialize(record,local);
            else await this.removeSibling(record);
        }
    }
    async clearHistory(conflicts,history,versions = new Map()) {
        let edited = await this.migrateLegacy(history);
        const active = (path,id) => versions.has(path) ? versions.get(path).split(",").includes(id) : conflicts.includes(path);
        let removed = 0;
        for (const r of this.copies.values()) {
            if (active(r.path,r.id)) continue;
            const existed = await this.disk.exists(siblingPath(r));
            if (!await this.removeSibling(r)) edited++;
            else if (existed) removed++;
        }
        if (!await this.disk.exists(this.root)) return {removed,edited};
        for (const dir of (await this.disk.list(this.root)).folders) {
            const match = revisionDir.exec(dir.slice(this.root.length+1));
            if (!match) continue;
            const visit = async parent => {
                const {files,folders} = await this.disk.list(parent);
                for (const file of files) {
                    const source = file.slice(dir.length+1);
                    if (source === ".partial") { await this.disk.remove(file); continue; }
                    if (!safePath(source) || active(source,match[1])) continue;
                    if (await sha(await this.disk.readBinary(file)) !== match[2]) { edited++; continue; }
                    await this.disk.remove(file);
                    removed++;
                }
                for (const sub of folders) await visit(sub);
                await this.trashEmpty(parent);
            };
            await visit(dir);
        }
        if (await this.disk.exists(this.markers)) {
            for (const file of (await this.disk.list(this.markers)).files) {
                const name = file.slice(this.markers.length+1);
                if (name.endsWith(".json.tmp") && revisionDir.test(name.slice(0,-9))) await this.disk.remove(file);
            }
            await this.prune(this.markers,this.root);
        } else await this.prune(this.root,this.root);
        return {removed,edited};
    }
}

module.exports = {ConflictFiles,siblingPath};
