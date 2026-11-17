"use strict";

const { Plugin, PluginSettingTab, Setting, Modal, Notice, TFile, TFolder, requestUrl, getLanguage } = require("obsidian");
const core = require("./core.cjs");
const tr = (en, zh) => getLanguage().startsWith("zh") ? zh : en;
const namespace = "homebound-v1";
const { Dav, VaultFiles, credentials } = require("./adapter.cjs");
const PqcMode = require("./pqc-mode.cjs");
const {ChunkTransfer, TransferCache, blockSize} = require("./transfer.cjs");
const modeKey = "homebound-webdav-mode";

async function probe(dav, milliseconds) {
    let timer;
    try {
        return await Promise.race([dav.read("vault.json").then(core.parseBytes), new Promise((_, reject) => {
            timer = setTimeout(() => reject(Object.assign(Error("WebDAV connection timed out."), { offline: true })), milliseconds);
        })]);
    } finally { clearTimeout(timer); }
}

async function connect(config, password, passphrase, transfer) {
    const auth = credentials(config.username, password);
    const dav = new Dav(core.gatewayUrl(config.address), auth).child(config.folder).child(namespace);
    const header = await probe(dav, 15000);
    const key = await core.unlock(header, passphrase, config.id);
    return { store: new core.Store(dav, header.id, key, transfer), route: "WebDAV" };
}

class ConfirmFolder extends Modal {
    constructor(app, config, create, done) { super(app); Object.assign(this, { config, create, done }); }
    onOpen() {
        this.setTitle(this.create ? tr("Create encrypted vault?", "创建加密库？") : tr("Use this remote folder?", "使用这个远端目录？"));
        this.contentEl.createEl("p", { text: this.config.address + "/" + core.encodePath(this.config.folder) });
        this.contentEl.createEl("p", { text: this.create ? tr("Creates a new encrypted vault in an empty folder through the WebDAV gateway.", "通过 WebDAV 网关，在空目录中创建新加密库。") :
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
        new Setting(el).setName(tr("Sync mode", "同步模式"))
            .setDesc(tr("PQC uses a separate remote folder. Switching modes keeps the notes on this device.", "PQC 使用独立的远端目录。切换后本机笔记会保留。"))
            .addDropdown(d => d.addOption("legacy", tr("Passphrase (0.1.1)", "口令同步（0.1.1）"))
                .addOption("pqc", tr("Post-quantum (PQC)", "后量子加密（PQC）")).setValue(p.mode)
                .onChange(mode => {
                    try { p.selectMode(mode); } catch (e) { new Notice(e.message); }
                    this.display();
                }));
        new Setting(el).setName(tr("Resumable large attachments", "大附件分块续传"))
            .setDesc(tr("Use version 0.2.1 or later on every device in this remote vault before enabling this option. Earlier stable releases cannot read chunked files.", "请先将此远端库的所有设备升级至 0.2.1 或更高版本，再启用此选项。更早的正式版无法读取分块附件。"))
            .addToggle(t => t.setValue(p.transfer.enabled).onChange(value => {
                p.transfer.enabled = value;
                p.app.saveLocalStorage("homebound-chunk-upload",value);
            }));
        if (p.mode === "pqc") {
            p.pqc.display(el, () => this.display());
            return;
        }
        const draft = { ...p.config };
        let password = "", passphrase = "";
        const field = (label, key, hint, placeholder) => new Setting(el).setClass("homebound-field").setName(label).setDesc(hint)
            .addText(t => t.setValue(draft[key] || "").setPlaceholder(placeholder).onChange(v => { draft[key] = v; }));
        field(tr("WebDAV address", "WebDAV 地址"), "address", tr("Use the same HTTPS gateway on every network.", "在家和外出都使用这个 HTTPS 网关。"), "https://dav.example.net");
        field(tr("Remote folder", "远端目录"), "folder", tr("Type the folder name as written, including spaces or Chinese characters.", "可直接输入中文、空格和多级目录。"), "笔记/我的知识库");
        field(tr("WebDAV username", "WebDAV 用户名"), "username", "", "");
        const secret = (label, cb) => new Setting(el).setClass("homebound-field").setName(label)
            .setDesc(p.config.id ? tr("Leave empty to use the saved secret.", "留空可沿用已保存的密码。") : "")
            .addText(t => { t.inputEl.type = "password"; t.inputEl.autocomplete = "off"; t.onChange(cb); });
        secret(tr("WebDAV password", "WebDAV 密码"), value => { password = value; });
        secret(tr("Vault encryption passphrase", "笔记库加密口令"), value => { passphrase = value; });
        const review = create => {
            try {
                const address = core.gatewayUrl(draft.address);
                const config = { ...draft, address, home: address, away: address,
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
        this.config.address = core.gatewayAddress(this.config);
        if (this.manifest.id !== "homebound-webdav") throw Error("Install this candidate as Homebound WebDAV.");
        this.transfer = new ChunkTransfer(new TransferCache(this.app.appId), {
            enabled: this.app.loadLocalStorage("homebound-chunk-upload") === true,
            active: () => !this.closed, progress: event => this.showTransfer(event)
        });
        const savedMode = this.app.loadLocalStorage(modeKey);
        if (savedMode != null && savedMode !== "legacy" && savedMode !== "pqc") throw Error("Unknown Homebound sync mode.");
        this.mode = savedMode || "legacy";
        if (this.mode === "pqc") this.pqc = new PqcMode(this.app,this.transfer);
        this.settingsTab = new HomeboundSettings(this.app, this);
        this.addSettingTab(this.settingsTab);
        const invites = require("./pairing-invite.cjs");
        this.registerObsidianProtocolHandler(invites.action, params => {
            try {
                const invite = invites.validate(params);
                require("./pairing-ui.cjs").join(this.app,invite,fields=>{
                    const saved=this.app.loadLocalStorage("homebound-webdav-pqc-config");
                    if(saved?.anchor && saved.anchor!==invite.anchor)throw Error("请打开要加入此远端库的独立本地库。");
                    this.selectMode("pqc");
                    return this.pqc.exclusive(()=>this.pqc.joinInvite(invite,fields));
                },()=>{this.app.setting.open();this.app.setting.openTabById(this.manifest.id);},this.mode!=="pqc");
            }catch(e){new Notice(e.message,10000);}
        });
        this.addCommand({ id: "sync", name: tr("Sync now", "立即同步"), callback: () => this.run() });
        this.addCommand({ id: "resolve", name: tr("Resolve conflict using the active file", "使用当前文件解决冲突"), checkCallback: checking => {
            const file = this.app.workspace.getActiveFile();
            if (this.mode !== "legacy" || !file || !this.conflicts?.includes(file.path)) return false;
            if (!checking) this.run(file.path);
            return true;
        } });
        this.addCommand({ id: "compare-pqc-conflict", name: tr("Compare PQC conflict copies", "比较 PQC 冲突副本"), checkCallback: checking => {
            const path = this.app.workspace.getActiveFile()?.path;
            if (this.mode !== "pqc" || !this.pqc.conflicts.includes(path)) return false;
            if (!checking) this.pqc.compare(path, () => this.settingsTab.display());
            return true;
        }});
        this.addCommand({ id: "seal-history", name: tr("Rotate PQC vault keys", "轮换 PQC 库密钥"), checkCallback: checking => {
            const q = this.pqc;
            if (this.mode !== "pqc" || !q?.config.admin) return false;
            if (!checking) q.exclusive(() => q.sealHistory()).then(() => new Notice(tr("Keys rotated.", "密钥已轮换。"))).catch(e => new Notice(e.message));
            return true;
        }});
        const syncIfEnabled = () => {
            if (this.mode === "legacy" && !this.closed && this.config.auto && !this.busy && document.visibilityState === "visible") this.run(null, true);
        };
        this.app.workspace.onLayoutReady(syncIfEnabled);
        this.registerDomEvent(document, "visibilitychange", syncIfEnabled);
        this.registerDomEvent(window, "online", syncIfEnabled);
        this.registerInterval(window.setInterval(syncIfEnabled, 300000));
    }
    selectMode(mode) {
        if (mode !== "legacy" && mode !== "pqc") throw Error("Unknown sync mode.");
        if (this.mode === mode) return;
        if (this.closed || this.busy || this.pqc?.busy) throw Error(tr("Finish the current sync first.", "请等当前操作完成后再切换。"));
        const next = mode === "pqc" ? new PqcMode(this.app,this.transfer) : null;
        this.app.saveLocalStorage(modeKey, mode);
        if (this.pqc) this.pqc.closed = true;
        this.pqc = next;
        this.mode = mode;
    }
    showTransfer(event) {
        if (!event) {
            this.transferNotice?.hide();
            this.transferNotice = null;
            return;
        }
        const action = event.direction === "upload" ? tr("Uploading","上传") : tr("Downloading","下载");
        const complete = Math.min(event.size,event.done * blockSize);
        let message = action + " " + event.path + "\n" + event.done + "/" + event.total + tr(" blocks"," 块") +
            " · " + Math.floor(100 * complete / event.size) + "%";
        if (event.retry) message += tr(" · retry "," · 重试 ") + event.retry + "/3";
        if (!this.transferNotice) this.transferNotice = new Notice(message,0);
        else this.transferNotice.setMessage(message);
    }
    onunload() { this.showTransfer(null); this.closed = true; if (this.pqc) this.pqc.closed = true; }
    secret(kind, config = this.config) {
        return config.secretId ? this.app.secretStorage.getSecret("homebound-" + config.secretId + "-" + kind) || "" : "";
    }
    async bind(config, create, enteredPassword, enteredPhrase) {
        if (this.closed || this.mode !== "legacy") return false;
        if (this.busy) { new Notice(tr("Sync is busy.", "同步进行中。")); return false; }
        this.busy = true;
        try {
            const password = config.username ? enteredPassword || this.secret("dav") : "";
            const phrase = enteredPhrase || this.secret("vault");
            if (!phrase || (create && phrase.length < 12)) throw Error(tr("Use a vault passphrase of at least 12 characters when creating a vault.", "创建新库请使用至少 12 个字符的加密口令。"));
            if (create) {
                const header = await core.createVault(new Dav(config.address, credentials(config.username, password)), config.folder, phrase, namespace);
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
        if (this.closed || this.busy) return;
        if (this.mode === "pqc") {
            const q = this.pqc;
            try {
                const result = await q.exclusive(() => q.sync());
                new Notice(q.syncSummary(result));
                this.settingsTab.display();
                return result;
            } catch (e) { new Notice(e.message); return; }
        }
        this.busy = true;
        try {
            const c = this.config;
            if (!c.id) throw Error(tr("Connect a vault in settings first.", "请先到设置中连接笔记库。"));
            const { store, route } = await connect(c, c.username ? this.secret("dav") : "", this.secret("vault"),this.transfer);
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
        } finally { this.busy = false; this.showTransfer(null); }
    }
};
