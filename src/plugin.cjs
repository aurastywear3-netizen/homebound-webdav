"use strict";

const {Plugin, Notice, getLanguage} = require("obsidian");
const core = require("./core.cjs");
const sharing = require("./pairing-invite.cjs");
const {Dav, VaultFiles, credentials} = require("./adapter.cjs");
const {ChunkTransfer, TransferCache, blockSize} = require("./transfer.cjs");
const {seedSnapshot, checkJoin} = require("./personal.cjs");
const {HomeboundSettings} = require("./settings.cjs");

const tr = (en, zh) => getLanguage().startsWith("zh") ? zh : en;
const stateKey = "homebound-personal-v2";
const baselineKey = id => stateKey + "-baseline-" + id;

function location(fields) {
    const address = core.davAddress(fields.address);
    const folder = core.directory(fields.folder);
    const username = fields.username?.trim();
    if (!username || username.includes(":")) throw Error("请输入有效的 WebDAV 用户名。");
    return {address, folder, username};
}

module.exports = class HomeboundPlugin extends Plugin {
    async onload() {
        this.closed = false;
        this.cache = new Map();
        this.state = this.app.loadLocalStorage(stateKey) || {};
        this.oldFormat = !this.state.current && Boolean((await this.loadData())?.id ||
            this.app.loadLocalStorage("homebound-webdav-pqc-config")?.anchor);
        this.transfer = new ChunkTransfer(new TransferCache(this.app.appId), {
            enabled: true, active: () => !this.closed, progress: event => this.showTransfer(event)
        });
        this.settingsTab = new HomeboundSettings(this.app, this);
        this.addSettingTab(this.settingsTab);
        this.addCommand({id:"sync", name:tr("Sync now","立即同步"), callback:() => this.run()});
        this.addCommand({id:"resolve", name:tr("Resolve conflict using the active file","使用当前文件解决冲突"), checkCallback:checking => {
            const path = this.app.workspace.getActiveFile()?.path;
            if (!this.conflicts?.includes(path)) return false;
            if (!checking) this.run(path);
            return true;
        }});
        const syncIfEnabled = () => {
            if (!this.closed && !this.state.pending && this.state.current?.auto && !this.busy &&
                document.visibilityState === "visible") this.run(null, true);
        };
        this.app.workspace.onLayoutReady(syncIfEnabled);
        this.registerDomEvent(document, "visibilitychange", syncIfEnabled);
        this.registerDomEvent(window, "online", syncIfEnabled);
        this.registerInterval(window.setInterval(syncIfEnabled, 300000));
    }

    save(state) {
        this.app.saveLocalStorage(stateKey, state);
        this.state = state;
    }
    secret(config, kind) {
        return this.app.secretStorage.getSecret("homebound-personal-" + config.secretId + "-" + kind) || "";
    }
    storeSecrets(config, key, password) {
        this.app.secretStorage.setSecret("homebound-personal-" + config.secretId + "-key", key);
        this.app.secretStorage.setSecret("homebound-personal-" + config.secretId + "-dav", password);
    }
    forgetSecrets(config) {
        this.storeSecrets(config, "", "");
    }
    passwordFor(target, entered) {
        const current = this.state.current;
        if (entered) return entered;
        if (current && target.address === current.address && target.username === current.username) {
            const saved = this.secret(current, "dav");
            if (saved) return saved;
        }
        throw Error("请填写此 WebDAV 地址的密码。");
    }
    baseline(id) { return new Map(this.app.loadLocalStorage(baselineKey(id)) || []); }
    checkpoint(id, data) { this.app.saveLocalStorage(baselineKey(id), Array.from(data)); }
    local() { return new VaultFiles(this.app); }
    dav(config, password) { return new Dav(config.address, credentials(config.username, password)); }
    async connect(config, password, material) {
        const dav = this.dav(config, password).child(config.folder).child(core.namespace);
        const header = core.parseBytes(await dav.read("vault.json"));
        const key = await core.unlock(header, material, config.id);
        return {store:new core.Store(dav, header.id, key, this.transfer), previous:header.previous};
    }
    async exclusive(action) {
        if (this.closed || this.busy) throw Error("请等当前操作完成后再试。");
        this.busy = true;
        try { return await action(); }
        finally { this.busy = false; this.showTransfer(null); }
    }
    activate(config) {
        if (this.closed) throw Error("插件已关闭，请重新打开后继续。");
        const former = this.state.current;
        this.save({current:config});
        if (former && former.secretId !== config.secretId) this.forgetSecrets(former);
        this.cache.clear();
        this.conflicts = [];
        this.oldFormat = false;
    }

    // Persist the key and target before the first WebDAV write. A lost response or
    // restart can resume the same target without replacing the current binding.
    async startSetup(fields, enteredPassword) {
        if (this.state.pending) throw Error("请先完成正在进行的建库。");
        const current = this.state.current;
        const target = location(fields);
        if (current) {
            const oldPath = current.address + "/" + core.encodePath(current.folder) + "/";
            const newPath = target.address + "/" + core.encodePath(target.folder) + "/";
            if (oldPath.startsWith(newPath) || newPath.startsWith(oldPath)) throw Error("请为换钥选择独立的新目录。");
            if (current.joinedFrom) throw Error("请先完成重新加入后的同步。");
            if (this.conflicts?.length) throw Error("请先解决已发现的冲突，再用完整本地副本换钥。");
        }
        const password = this.passwordFor(target, enteredPassword);
        const config = {...target, id:core.randomId(), secretId:core.randomId(), auto:false};
        this.storeSecrets(config, core.generateKey(), password);
        this.save({...this.state, pending:config});
        return this.resumeSetup();
    }
    async resumeSetup(enteredPassword = "") {
        const config = this.state.pending;
        if (!config) throw Error("没有待完成的建库。");
        const password = enteredPassword || this.secret(config, "dav"), material = this.secret(config, "key");
        if (!password || !material) throw Error("缺少本机保存的建库凭据。");
        const previous = this.state.current?.id || "";
        if (enteredPassword) this.storeSecrets(config, material, password);
        await core.createVault(this.dav(config,password), config.folder, material, config.id, previous);
        const {store} = await this.connect(config,password,material);
        const baseline = await seedSnapshot(store, this.local(), () => !this.closed);
        this.checkpoint(config.id, baseline);
        this.activate(config);
        this.last = tr("Upload and readback verified.","已完成上传和读回校验。");
        new Notice(this.last);
    }
    async join(fields, material, id) {
        if (this.state.pending) throw Error("请先完成或取消正在进行的建库。");
        sharing.backup(id, material);
        const target = location(fields);
        const password = this.passwordFor(target, fields.password);
        const current = this.state.current;
        const config = {...target, id, secretId:core.randomId(), auto:Boolean(current?.id === id && current.auto)};
        const {store, previous} = await this.connect(config, password, material);
        if (current?.id !== id) {
            if (current && current.id !== previous) throw Error("当前本地库已绑定另一个库。请打开对应的独立本地库。");
            await checkJoin(store, this.local(), current ? this.baseline(current.id) : undefined);
            if (current) config.joinedFrom = current.id;
        } else if (current.joinedFrom) {
            config.joinedFrom = current.joinedFrom;
        }
        this.storeSecrets(config, material, password);
        this.activate(config);
    }
    sharingFields() {
        const c = this.state.current;
        return {...c, password:this.secret(c, "dav"), key:this.secret(c, "key")};
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
    onunload() { this.closed = true; this.showTransfer(null); }

    async run(resolve = null, quiet = false) {
        if (this.closed || this.busy) return;
        try {
            return await this.exclusive(async () => {
                const c = this.state.current;
                if (this.state.pending) throw Error("请先完成建库或换钥。");
                if (!c) throw Error("请先创建或扫码加入笔记库。");
                const {store} = await this.connect(c, this.secret(c,"dav"), this.secret(c,"key"));
                const local = this.local();
                let reconciled = 0;
                if (c.joinedFrom) {
                    const updates = await checkJoin(store, local, this.baseline(c.joinedFrom));
                    for (const {path, hash, target} of updates) {
                        if (this.closed) throw Error("同步已停止。");
                        const body = target && target.hash !== null ? await store.readBody(target) : null;
                        await local.apply(path, hash, body);
                        reconciled++;
                    }
                    // Keep this transition across restarts until all stale files have been reconciled.
                    const updated = {...this.state.current};
                    delete updated.joinedFrom;
                    this.save({current:updated});
                }
                const result = await core.synchronize({store, local, cache:this.cache, baseline:this.baseline(c.id),
                    resolve, active:() => !this.closed, checkpoint:data => this.checkpoint(c.id,data)});
                result.received += reconciled;
                this.cache = result.history;
                this.conflicts = result.conflicts;
                this.last = tr("Uploaded ","已上传 ") + result.sent + tr(" · received "," · 已接收 ") + result.received;
                if (result.conflicts.length) this.last += "\n" + tr("Compare copies in Homebound conflicts, then resolve the active file: ",
                    "请比较 Homebound conflicts 中的副本，再打开原文件解决冲突：") + result.conflicts.join(", ");
                if (!quiet || result.conflicts.length) new Notice(this.last, 9000);
                return result;
            });
        } catch (e) {
            this.last = tr("Sync stopped: ","同步已停止：") + e.message;
            if (!quiet) new Notice(this.last, 10000);
        }
    }
};
