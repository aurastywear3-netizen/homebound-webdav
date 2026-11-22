"use strict";

const {Plugin, Notice, getLanguage} = require("obsidian");
const core = require("./core.cjs");
const sharing = require("./pairing-invite.cjs");
const {Dav, VaultFiles, credentials} = require("./adapter.cjs");
const {ChunkTransfer, TransferCache, blockSize} = require("./transfer.cjs");
const {seedSnapshot, checkJoin} = require("./personal.cjs");
const {PendingUploads} = require("./pending.cjs");
const {ConflictReview} = require("./review.cjs");
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
        this.restoreStatus();
        this.oldFormat = !this.state.current && Boolean((await this.loadData())?.id ||
            this.app.loadLocalStorage("homebound-webdav-pqc-config")?.anchor);
        this.transfer = new ChunkTransfer(new TransferCache(this.app.appId), {
            enabled: true, active: () => !this.closed, progress: event => this.showTransfer(event)
        });
        this.settingsTab = new HomeboundSettings(this.app, this);
        this.addSettingTab(this.settingsTab);
        this.addCommand({id:"sync", name:tr("Sync now","立即同步"), callback:() => this.run()});
        this.addCommand({id:"resolve", name:tr("Compare and resolve file conflict","比较并解决文件冲突"), checkCallback:checking => {
            const path = this.app.workspace.getActiveFile()?.path;
            if (!this.conflicts.includes(path)) return false;
            if (!checking) this.openConflict(path);
            return true;
        }});
        const check = () => this.requestAuto(true);
        this.app.workspace.onLayoutReady(() => {
            if (this.closed) return;
            this.ready = true;
            const vault = this.app.vault;
            for (const event of ["create","modify","delete","rename"]) {
                this.registerEvent(vault.on(event, (file, oldPath) => this.fileChanged(event, file, oldPath)));
            }
            this.scheduleCount();
            check();
        });
        this.registerDomEvent(document, "visibilitychange", check);
        this.registerDomEvent(window, "online", check);
        this.registerInterval(window.setInterval(check, 300000));
    }

    restoreStatus() {
        this.uploads = new PendingUploads();
        const id = this.state.current?.id;
        this.status = (id && this.app.loadLocalStorage(stateKey + "-status-" + id)) || {};
        this.conflicts = this.status.conflicts || [];
        this.autoDue = null;
        clearTimeout(this.editTimer);
        this.editTimer = null;
    }
    recordSuccess(conflicts) {
        this.conflicts = conflicts;
        this.status = {lastSuccess:Date.now(), conflicts};
        this.app.saveLocalStorage(stateKey + "-status-" + this.state.current.id, this.status);
        this.settingsTab.refreshStatus();
    }
    fileChanged(event, file, oldPath) {
        if (!this.state.current || this.closed) return;
        const local = this.local();
        const paths = [file.path, oldPath].filter(path => path && local.allowed(path));
        if (!paths.length) return;
        if (Array.isArray(file.children)) {
            if (event !== "rename" && event !== "delete") return;
            this.uploads.full = true;
        } else {
            for (const path of paths) this.uploads.candidates.add(path);
        }
        this.scheduleCount();
        if (!this.state.current.auto) return;
        clearTimeout(this.editTimer);
        if (this.autoDue === "edit") this.autoDue = null;
        this.editTimer = setTimeout(() => {
            this.editTimer = null;
            this.requestAuto(false);
        }, 4000);
    }
    scheduleCount() {
        clearTimeout(this.countTimer);
        if (!this.ready || this.busy || this.closed || !this.settingsTab.statusVisible()) return;
        this.countTimer = setTimeout(() => this.refreshCount(), 200);
    }
    async refreshCount() {
        const id = this.state.current?.id, uploads = this.uploads;
        if (!id || this.busy || this.closed) return;
        try {
            do {
                await uploads.refresh(this.local(), () => this.baseline(id), () => uploads === this.uploads && !this.closed);
            } while ((uploads.full || uploads.candidates.size) && uploads === this.uploads && !this.closed && !this.busy);
        } catch {
            // A file may have moved during the read. The next event/check retries.
        }
        if (uploads === this.uploads && !this.closed) this.settingsTab.refreshStatus();
    }
    autoEnabled() {
        return !this.closed && this.state.current?.auto && !this.state.pending &&
            document.visibilityState === "visible";
    }
    async requestAuto(force) {
        if (!this.autoEnabled()) return;
        if (this.busy) {
            if (force || !this.autoDue) this.autoDue = force ? "check" : "edit";
            return;
        }
        if (!force) {
            const uploads = this.uploads;
            await this.refreshCount();
            if (!this.autoEnabled() || uploads !== this.uploads || this.editTimer) return;
            if (this.busy) { this.autoDue ||= "edit"; return; }
            if (uploads.known && !uploads.files.size) return;
        }
        await this.run(null, true);
    }
    setAuto(value) {
        if (!this.state.current || this.state.pending) return;
        this.save({current:{...this.state.current,auto:value}});
        clearTimeout(this.editTimer);
        this.editTimer = null;
        this.autoDue = null;
        if (value) this.requestAuto(true);
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
        try {
            if (this.uploads.work) await this.uploads.work.catch(() => {});
            return await action();
        } finally {
            this.busy = false;
            this.showTransfer(null);
            for (const path of this.uploads.files) this.uploads.candidates.add(path);
            this.scheduleCount();
            const due = this.autoDue;
            this.autoDue = null;
            if (due) queueMicrotask(() => this.requestAuto(due === "check"));
        }
    }
    activate(config) {
        if (this.closed) throw Error("插件已关闭，请重新打开后继续。");
        const former = this.state.current;
        this.save({current:config});
        if (former && former.secretId !== config.secretId) this.forgetSecrets(former);
        this.cache.clear();
        this.restoreStatus();
        this.last = "";
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
        this.recordSuccess([]);
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
    onunload() {
        this.closed = true;
        clearTimeout(this.editTimer);
        clearTimeout(this.countTimer);
        this.showTransfer(null);
    }

    async openConflict(path) {
        try {
            const review = await this.exclusive(async () => {
                const c = this.state.current;
                if (!c || this.state.pending) throw Error(tr("Finish vault setup first.","请先完成建库。"));
                const {store} = await this.connect(c, this.secret(c,"dav"), this.secret(c,"key"));
                const heads = core.headsByPath(await store.history(this.cache)).get(path) || [];
                if (new Set(heads.map(r => r.hash)).size < 2) throw Error(tr("This conflict changed. Sync again.","冲突已变化，请重新同步。"));
                const local = this.local(), bytes = await local.read(path);
                const readVersion = async rev => {
                    const copy = await local.read(core.conflictFolder + "/" + rev.id + "/" + rev.path);
                    if (copy !== null && await core.sha(copy) === rev.hash) return copy;
                    return this.exclusive(() => store.readBody(rev));
                };
                return {path, vaultId:c.id, heads, headIds:heads.map(r => r.id).sort(), bytes,
                    localHash:bytes === null ? null : await core.sha(bytes), readVersion};
            });
            if (!this.closed) new ConflictReview(this.app, review, async source => {
                if (this.state.current?.id !== review.vaultId || this.closed) throw Error(tr("Vault changed.","当前库已变化。"));
                if (this.busy) throw Error(tr("Sync in progress. Try again.","正在同步，请稍后重试。"));
                const selection = {path, headIds:review.headIds, localHash:review.localHash, source};
                const result = await this.run(selection);
                if (!result) throw Error(this.last);
            }).open();
        } catch (error) { new Notice(error.message); }
    }

    async run(selection = null, quiet = false) {
        if (typeof selection === "string") return this.openConflict(selection);
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
                    selection, active:() => !this.closed, checkpoint:data => this.checkpoint(c.id,data)});
                result.received += reconciled;
                this.cache = result.history;
                const newConflict = result.conflicts.some(path => !this.conflicts.includes(path));
                this.last = tr("Uploaded ","已上传 ") + result.sent + tr(" · received "," · 已接收 ") + result.received;
                if (result.conflicts.length) this.last += "\n" + tr("Review conflicts in Homebound settings: ","请在 Homebound 设置中比较冲突：") + result.conflicts.length;
                this.recordSuccess(result.conflicts);
                if (!quiet || newConflict) {
                    if (result.conflicts.length) {
                        const message = document.createDocumentFragment();
                        message.append(this.last + " ");
                        const compare = document.createElement("button");
                        compare.textContent = tr("Compare conflict","比较冲突");
                        compare.addEventListener("click", () => this.openConflict(result.conflicts[0]));
                        message.append(compare);
                        new Notice(message, 9000);
                    } else new Notice(this.last, 9000);
                }
                return result;
            });
        } catch (e) {
            this.last = tr("Sync stopped: ","同步已停止：") + e.message;
            this.settingsTab.refreshStatus();
            if (!quiet) new Notice(this.last, 10000);
        }
    }
};
