"use strict";

const { Plugin, PluginSettingTab, Setting, Modal, Notice, TFile, TFolder, requestUrl, getLanguage } = require("obsidian");
const core = require("./core.cjs");
const tr = (en, zh) => getLanguage().startsWith("zh") ? zh : en;
const namespace = "homebound-v1";
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

async function probe(dav, milliseconds) {
    let timer;
    try {
        return await Promise.race([dav.read("vault.json").then(core.parseBytes), new Promise((_, reject) => {
            timer = setTimeout(() => reject(Object.assign(Error("WebDAV connection timed out."), { offline: true })), milliseconds);
        })]);
    } finally { clearTimeout(timer); }
}

async function connect(config, password, passphrase) {
    const auth = credentials(config.username, password);
    const addresses = [[config.home, "LAN"]];
    if (config.away && config.away !== config.home) addresses.push([config.away, "VPS/VPN"]);
    for (const [index, [address, route]] of addresses.entries()) {
        const dav = new Dav(address, auth).child(config.folder).child(namespace);
        let header;
        try { header = await probe(dav, index === 0 && addresses.length > 1 ? 2500 : 15000); }
        catch (error) {
            if (error.offline && index + 1 < addresses.length) continue;
            throw error;
        }
        const key = await core.unlock(header, passphrase, config.id);
        return { store: new core.Store(dav, header.id, key), route };
    }
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

class ConfirmFolder extends Modal {
    constructor(app, config, create, done) { super(app); Object.assign(this, { config, create, done }); }
    onOpen() {
        this.setTitle(this.create ? tr("Create encrypted vault?", "创建加密库？") : tr("Use this remote folder?", "使用这个远端目录？"));
        this.contentEl.createEl("p", { text: this.config.home + "/" + core.encodePath(this.config.folder) });
        if (this.config.away) this.contentEl.createEl("p", { text: this.config.away + "/" + core.encodePath(this.config.folder) });
        this.contentEl.createEl("p", { text: this.create ? tr("Creates a new encrypted vault in an empty folder using the LAN address.", "通过局域网地址，在空目录中创建新加密库。") :
            tr("Verifies the passphrase and saves this vault on this device.", "验证加密口令后，将这个库绑定到当前设备。") });
        new Setting(this.contentEl)
            .addButton(b => b.setButtonText(tr("Cancel", "取消")).onClick(() => this.close()))
            .addButton(b => b.setCta().setButtonText(tr("Confirm", "确认")).onClick(() => { this.close(); this.done(); }));
    }
    onClose() { this.contentEl.empty(); }
}

class HomeboundSettings extends PluginSettingTab {
    constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
    display() {
        const p = this.plugin, el = this.containerEl;
        el.empty();
        el.addClass("homebound-settings");
        const draft = { ...p.config };
        let password = "", passphrase = "";
        const field = (label, key, hint, placeholder) => new Setting(el).setName(label).setDesc(hint)
            .addText(t => t.setValue(draft[key] || "").setPlaceholder(placeholder).onChange(v => { draft[key] = v; }));
        field(tr("LAN WebDAV address", "局域网 WebDAV 地址"), "home", tr("Use the server’s HTTPS address.", "填写服务器的 HTTPS 地址。"), "https://nas.example.net/dav");
        field(tr("Away WebDAV address", "外网 WebDAV 地址"), "away", tr("Optional HTTPS gateway to the same server.", "可选。填写转发到同一台服务器的 HTTPS 地址。"), "https://dav.example.net/dav");
        field(tr("Remote folder", "远端目录"), "folder", tr("Type the folder name as written, including spaces or Chinese characters.", "可直接输入中文、空格和多级目录。"), "笔记/我的知识库");
        field(tr("WebDAV username", "WebDAV 用户名"), "username", "", "");
        const secret = (label, cb) => new Setting(el).setName(label)
            .setDesc(p.config.id ? tr("Leave empty to use the saved secret.", "留空可沿用已保存的密码。") : "")
            .addText(t => { t.inputEl.type = "password"; t.inputEl.autocomplete = "off"; t.onChange(cb); });
        secret(tr("WebDAV password", "WebDAV 密码"), value => { password = value; });
        secret(tr("Vault encryption passphrase", "笔记库加密口令"), value => { passphrase = value; });
        const review = create => {
            try {
                const config = { ...draft, home: core.endpoint(draft.home), away: draft.away.trim() ? core.endpoint(draft.away) : "",
                    folder: core.directory(draft.folder), username: draft.username.trim() };
                const changedFolder = config.folder !== p.config.folder;
                if (create || changedFolder) config.id = "";
                new ConfirmFolder(this.app, config, create, () => p.bind(config, create, password, passphrase).then(ok => { if (ok) this.display(); })).open();
            } catch (e) { new Notice(e.message); }
        };
        new Setting(el).addButton(b => b.setButtonText(tr("Create new vault…", "创建新库…")).onClick(() => review(true)))
            .addButton(b => b.setCta().setButtonText(tr("Connect existing vault…", "连接已有库…")).onClick(() => review(false)));
        if (!p.config.id) return;
        new Setting(el).setName(tr("Sync while open", "打开期间自动同步"))
            .setDesc(tr("Check for changes every five minutes.", "每五分钟检查一次变更。"))
            .addToggle(t => t.setValue(Boolean(p.config.auto)).onChange(async value => {
                p.config.auto = value; await p.saveData(p.config);
            }));
        new Setting(el).addButton(b => b.setButtonText(tr("Sync now", "立即同步")).onClick(() => p.run()));
        if (p.last) el.createEl("p", { text: p.last });
    }
}

module.exports = class HomeboundPlugin extends Plugin {
    async onload() {
        this.closed = false;
        this.cache = new Map();
        this.config = { home: "", away: "", folder: this.app.vault.getName(), username: "", id: "", auto: false,
            ...await this.loadData() };
        this.addSettingTab(new HomeboundSettings(this.app, this));
        this.addCommand({ id: "sync", name: tr("Sync now", "立即同步"), callback: () => this.run() });
        this.addCommand({ id: "resolve", name: tr("Resolve conflict using the active file", "使用当前文件解决冲突"), checkCallback: checking => {
            const file = this.app.workspace.getActiveFile();
            if (!file || !this.conflicts?.includes(file.path)) return false;
            if (!checking) this.run(file.path);
            return true;
        } });
        const syncIfEnabled = () => {
            if (!this.closed && this.config.auto && !this.busy && document.visibilityState === "visible") this.run(null, true);
        };
        this.app.workspace.onLayoutReady(syncIfEnabled);
        this.registerDomEvent(document, "visibilitychange", syncIfEnabled);
        this.registerDomEvent(window, "online", syncIfEnabled);
        this.registerInterval(window.setInterval(syncIfEnabled, 300000));
    }
    onunload() { this.closed = true; }
    secret(kind, config = this.config) {
        return config.secretId ? this.app.secretStorage.getSecret("homebound-" + config.secretId + "-" + kind) || "" : "";
    }
    async bind(config, create, enteredPassword, enteredPhrase) {
        if (this.busy) { new Notice(tr("Sync is busy.", "同步进行中。")); return false; }
        this.busy = true;
        try {
            const password = config.username ? enteredPassword || this.secret("dav") : "";
            const phrase = enteredPhrase || this.secret("vault");
            if (!phrase || (create && phrase.length < 12)) throw Error(tr("Use a vault passphrase of at least 12 characters when creating a vault.", "创建新库请使用至少 12 个字符的加密口令。"));
            if (create) {
                const header = await core.createVault(new Dav(config.home, credentials(config.username, password)), config.folder, phrase, namespace);
                config.id = header.id;
            }
            const { store } = await connect(config, password, phrase);
            config.id = store.id;
            config.secretId = config.secretId || core.randomId();
            this.app.secretStorage.setSecret("homebound-" + config.secretId + "-vault", phrase);
            if (password) this.app.secretStorage.setSecret("homebound-" + config.secretId + "-dav", password);
            config.auto = false;
            await this.saveData(config);
            this.config = config;
            this.cache.clear();
            this.conflicts = [];
            new Notice(tr("Vault connected.", "已连接笔记库。"));
            return true;
        } catch (e) { this.last = e.message; new Notice(this.last, 10000); return false; }
        finally { this.busy = false; }
    }
    async run(resolve = null, quiet = false) {
        if (this.busy) return;
        this.busy = true;
        try {
            const c = this.config;
            if (!c.id) throw Error(tr("Connect a vault in settings first.", "请先到设置中连接笔记库。"));
            const { store, route } = await connect(c, c.username ? this.secret("dav") : "", this.secret("vault"));
            const key = "homebound-webdav-baseline-" + c.id;
            const baseline = new Map(this.app.loadLocalStorage(key) || []);
            const result = await core.synchronize({ store, local: new VaultFiles(this.app), cache: this.cache, baseline, resolve,
                active: () => !this.closed, checkpoint: data => this.app.saveLocalStorage(key, Array.from(data)) });
            this.cache = result.history;
            this.conflicts = result.conflicts;
            this.last = route + tr(" · uploaded ", " · 已上传 ") + result.sent + tr(" · received ", " · 已接收 ") + result.received;
            if (result.conflicts.length) this.last += "\n" + tr("Conflicts: ", "冲突文件：") + result.conflicts.join(", ") + "\n" +
                tr("Compare copies in Homebound conflicts, then resolve from the original file.", "请比较 Homebound conflicts 中的副本，再打开原文件并运行解决冲突命令。");
            if (!quiet || result.conflicts.length) new Notice(this.last, 9000);
            return result;
        } catch (e) {
            this.last = tr("Sync stopped: ", "同步已停止：") + e.message;
            if (!quiet) new Notice(this.last, 10000);
        } finally { this.busy = false; }
    }
};
