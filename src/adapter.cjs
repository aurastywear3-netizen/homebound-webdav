"use strict";

const { Plugin, PluginSettingTab, Setting, Modal, Notice, TFile, TFolder, requestUrl, getLanguage } = require("obsidian");
const core = require("./core.cjs");
const tr = (en, zh) => getLanguage().startsWith("zh") ? zh : en;

const paused = () => new Error(tr("File changed during sync. Run sync again.", "文件在同步期间发生变化，请再同步一次。"));

class Dav {
    constructor(root, authorization) {
        this.root = root;
        this.authorization = authorization;
    }
    child(path) { return new Dav(this.root + "/" + core.encodePath(path), this.authorization); }
    async call(method, path, accepted, extras = {}) {
        const url = path ? this.root + "/" + core.encodePath(path) : this.root;
        const headers = { ...extras.headers };
        if (this.authorization) headers.Authorization = this.authorization;
        let response;
        try { response = await requestUrl({ url, method, ...extras, headers, throw: false }); }
        catch { throw Object.assign(Error(tr("Server unreachable. Check the route and TLS certificate.", "无法连接服务器，请检查网络和 TLS 证书。")), { offline: true }); }
        if (!accepted.includes(response.status)) {
            throw Object.assign(Error(method + " returned HTTP " + response.status), {
                status: response.status, offline: [502, 503, 504].includes(response.status)
            });
        }
        return response;
    }
    async read(path) { return (await this.call("GET", path, [200])).arrayBuffer; }
    async put(path, body) {
        await this.call("PUT", path, [200, 201, 204], { body, contentType: "application/octet-stream" });
    }
    async mkdir(path) { await this.call("MKCOL", path, [201]); }
    async list(path = "") {
        const result = await this.call("PROPFIND", path, [207], {
            headers: { Depth: "1" }, contentType: "application/xml; charset=utf-8",
            body: '<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>'
        });
        const xml = new DOMParser().parseFromString(result.text, "application/xml");
        const docs = (el, tag) => Array.from(el.getElementsByTagNameNS("DAV:", tag));
        if (xml.documentElement.localName !== "multistatus" || xml.documentElement.namespaceURI !== "DAV:") {
            throw Error("Invalid WebDAV directory response.");
        }
        const url = new URL(path ? this.child(path).root : this.root);
        const segments = pathname => pathname.replace(/\/+$/, "").split("/").map(x => decodeURIComponent(x).normalize("NFC"));
        const base = segments(url.pathname);
        let self = false;
        const names = [];
        for (const entry of docs(xml, "response")) {
            const href = docs(entry, "href")[0]?.textContent;
            const successful = docs(entry, "status").some(s => /^HTTP\/\S+ 2\d\d\b/i.test(s.textContent.trim()));
            if (!href || !successful) throw Error("Incomplete WebDAV directory response.");
            const item = segments(new URL(href, url.href.replace(/\/+$/, "") + "/").pathname);
            if (!base.every((part, i) => part === item[i])) throw Error("WebDAV returned an unexpected directory.");
            if (item.length === base.length) { self = true; continue; }
            if (item.length !== base.length + 1) throw Error("WebDAV returned an unexpected child path.");
            names.push(item[item.length - 1]);
        }
        if (!self) throw Error("WebDAV did not confirm the requested directory.");
        return names;
    }
}

function credentials(username, password) {
    if (!username && !password) return "";
    if (!username || username.includes(":")) throw Error("Enter a valid WebDAV username.");
    const bytes = new TextEncoder().encode(username + ":" + password);
    return "Basic " + btoa(Array.from(bytes, b => String.fromCharCode(b)).join(""));
}

class VaultFiles {
    constructor(app) { this.app = app; this.vault = app.vault; }
    allowed(path) {
        const first = path.split("/")[0].toLowerCase();
        return !core.isRecovery(path) && first !== this.vault.configDir.toLowerCase() &&
            !path.split("/").some(part => part.startsWith("."));
    }
    paths() { return new Set(this.vault.getFiles().map(f => f.path).filter(path => this.allowed(path))); }
    file(path) {
        const item = this.vault.getAbstractFileByPath(path);
        if (item && (item.path !== path || !(item instanceof TFile))) throw Error("File or folder collision: " + path);
        return item;
    }
    async read(path) {
        const file = this.file(path);
        return file ? this.vault.readBinary(file) : null;
    }
    async folders(path) {
        const parts = path.split("/").slice(0, -1);
        let name = "";
        for (const part of parts) {
            name += (name ? "/" : "") + part;
            let folder = this.vault.getAbstractFileByPath(name);
            if (!folder) {
                try { folder = await this.vault.createFolder(name); }
                catch (error) {
                    folder = this.vault.getAbstractFileByPath(name);
                    if (!folder) throw error;
                }
            }
            if (!(folder instanceof TFolder) || folder.path !== name) throw Error("Folder collision: " + name);
        }
    }
    async apply(path, expected, bytes) {
        const old = await this.read(path);
        if ((old === null ? null : await core.sha(old)) !== expected) throw paused();
        const file = this.file(path);
        if (old === null) {
            if (bytes !== null) { await this.folders(path); await this.vault.createBinary(path, bytes); }
            return;
        }
        if (!file) throw paused();
        if (bytes === null) { await this.app.fileManager.trashFile(file); return; }
        if (file.extension.toLowerCase() === "md") {
            const decode = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
            const before = decode.decode(old), after = decode.decode(bytes);
            await this.vault.process(file, current => {
                if (current !== before) throw paused();
                return after;
            });
        } else {
            await this.vault.modifyBinary(file, bytes);
        }
    }
    async archive(rev, body) {
        const path = core.conflictFolder + "/" + rev.id + "/" + rev.path;
        const current = await this.read(path);
        if (current !== null) {
            if (await core.sha(current) !== rev.hash) throw Error("Move your edited conflict copy before syncing: " + path);
            return;
        }
        await this.apply(path, null, await body());
    }
}

module.exports = { Dav, VaultFiles, credentials };
