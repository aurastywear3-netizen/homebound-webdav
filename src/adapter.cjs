"use strict";

const { Plugin, PluginSettingTab, Setting, Modal, Notice, TFile, TFolder, requestUrl, getLanguage } = require("obsidian");
const core = require("./core.cjs");
const tr = (en, zh) => getLanguage().startsWith("zh") ? zh : en;

const paused = () => new Error(tr("File changed during sync. Run sync again.", "文件在同步期间发生变化，请再同步一次。"));
const pathSegments = pathname => pathname.replace(/\/+$/, "").split("/").map(x => decodeURIComponent(x).normalize("NFC"));

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
    async collectionMarker() {
        const result = await this.call("PROPFIND", "commits", [207,405,501], {
            headers: {Depth:"0", "Cache-Control":"no-cache"}, contentType:"application/xml; charset=utf-8",
            body:'<d:propfind xmlns:d="DAV:"><d:prop><d:sync-token/><d:getetag/><d:getlastmodified/></d:prop></d:propfind>'
        });
        if (result.status !== 207) return null;
        const xml = new DOMParser().parseFromString(result.text, "application/xml");
        const responses = xml.getElementsByTagNameNS("DAV:", "response");
        if (xml.documentElement.namespaceURI !== "DAV:" || xml.documentElement.localName !== "multistatus" || responses.length !== 1)
            throw Error("Invalid WebDAV version response.");
        const expected = new URL(this.child("commits").root);
        const href = responses[0].getElementsByTagNameNS("DAV:", "href")[0]?.textContent;
        if (!href || JSON.stringify(pathSegments(new URL(href, expected.href + "/").pathname)) !== JSON.stringify(pathSegments(expected.pathname)))
            throw Error("Unexpected WebDAV version path.");
        const props = new Map();
        for (const group of responses[0].getElementsByTagNameNS("DAV:", "propstat")) {
            const status = group.getElementsByTagNameNS("DAV:", "status")[0]?.textContent.trim();
            if (!/^HTTP\/\S+ 200\b/.test(status)) continue;
            for (const prop of group.getElementsByTagNameNS("DAV:", "prop")[0]?.children || []) {
                if (prop.namespaceURI === "DAV:" && prop.textContent.trim()) props.set(prop.localName, prop.textContent.trim());
            }
        }
        if (props.has("sync-token")) return {tag:"sync:"+props.get("sync-token")};
        const etag = props.get("getetag"), modified = props.get("getlastmodified");
        if (etag || modified) return {tag:JSON.stringify([etag,modified]), coarse:true};
        return null;
    }
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
        const base = pathSegments(url.pathname);
        let self = false;
        const names = [];
        for (const entry of docs(xml, "response")) {
            const href = docs(entry, "href")[0]?.textContent;
            const successful = docs(entry, "status").some(s => /^HTTP\/\S+ 2\d\d\b/i.test(s.textContent.trim()));
            if (!href || !successful) throw Error("Incomplete WebDAV directory response.");
            const item = pathSegments(new URL(href, url.href.replace(/\/+$/, "") + "/").pathname);
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
    constructor(app, copies) { this.app = app; this.vault = app.vault; this.copies = copies; }
    allowed(path) {
        const first = path.split("/")[0].toLowerCase();
        return !this.copies.paths.has(path) && !core.isRecovery(path) && first !== this.vault.configDir.toLowerCase() &&
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
    archive(rev, body) { return this.copies.archive(rev,body); }
}

module.exports = { Dav, VaultFiles, credentials };
