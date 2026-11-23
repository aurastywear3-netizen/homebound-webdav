"use strict";

const {Plugin, Notice, getLanguage} = require("obsidian");
const core = require("./core.cjs");
const sharing = require("./pairing-invite.cjs");
const {Dav, VaultFiles, credentials} = require("./adapter.cjs");
const {ChunkTransfer, TransferCache, blockSize} = require("./transfer.cjs");
const {ReadWindow, concurrencyLevels} = require("./parallel-reads.cjs");
const {seedSnapshot, checkJoin} = require("./personal.cjs");
const {PendingUploads} = require("./pending.cjs");
const {ConflictFiles} = require("./conflict-files.cjs");
const {ConflictReview} = require("./review.cjs");
const {notePlan,isNote} = require("./merge.cjs");
const {HomeboundSettings} = require("./settings.cjs");
const {RevisionCache} = require("./revision-cache.cjs");
const {VersionWatch} = require("./version.cjs");
const historyTools = require("./history.cjs");
const {HistoryModal} = require("./history-view.cjs");

const tr = (en, zh) => getLanguage().startsWith("zh") ? zh : en;
const stateKey = "homebound-personal-v2";
const openReviewKey = stateKey + "-open-review";
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
        const directory = this.manifest.dir || this.app.vault.configDir + "/plugins/homebound-webdav";
        this.revisions = new RevisionCache(this.app, directory);
        const current = this.state.current;
        if (current) this.cache = await this.revisions.load(current.id, this.secret(current, "key"));
        this.copies = new ConflictFiles(this.app, directory);
        await this.copies.load();
        this.restoreStatus();
        this.oldFormat = !this.state.current && Boolean((await this.loadData())?.id ||
            this.app.loadLocalStorage("homebound-webdav-pqc-config")?.anchor);
        this.transfer = new ChunkTransfer(new TransferCache(this.app.appId), {
            enabled: true, active: () => !this.closed, progress: event => this.showTransfer(event)
        });
        this.settingsTab = new HomeboundSettings(this.app, this);
        this.addSettingTab(this.settingsTab);
        this.addCommand({id:"sync", name:tr("Sync now","立即同步"), callback:() => this.run()});
        this.addCommand({id:"view-history",name:tr("View version history","查看历史版本"),checkCallback:checking=>{
            if (!this.state.current || this.state.pending) return false;
            if (!checking) this.openHistory();
            return true;
        }});
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
        this.registerInterval(window.setInterval(() => {
            this.settingsTab.refreshHistoryPeriod?.();
            this.pollRemote();
        }, 5000));
    }

    restoreStatus() {
        this.historyModal?.close();
        this.nextHistoryCheck = 0;
        this.historyError = "";
        this.watch = new VersionWatch();
        this.pollError = "";
        this.syncError = "";
        this.syncSerial = 0;
        this.reviewed = new Map();
        this.conflictVersions = new Map();
        this.reviewModal?.close();
        this.uploads = new PendingUploads();
        const id = this.state.current?.id;
        this.status = (id && this.app.loadLocalStorage(stateKey + "-status-" + id)) || {};
        this.conflicts = this.status.conflicts || [];
        this.autoDue = null;
        clearTimeout(this.editTimer);
        this.editTimer = null;
    }
    recordSuccess(conflicts) {
        this.syncError = "";
        this.conflicts = conflicts;
        this.status = {lastSuccess:Date.now(), conflicts};
        this.app.saveLocalStorage(stateKey + "-status-" + this.state.current.id, this.status);
        const modal = this.reviewModal;
        if (modal && modal.review.vaultId === this.state.current.id &&
            !modal.submitting && !conflicts.includes(modal.review.path)) {
            modal.close();
        }
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
        clearTimeout(this.editTimer);
        if (this.autoDue === "edit") this.autoDue = null;
        this.editTimer = setTimeout(() => {
            this.editTimer = null;
            const check = this.autoDue === "check";
            this.autoDue = null;
            this.requestAuto(check);
        }, 2000);
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
        return !this.closed && this.ready && this.state.current && !this.state.pending &&
            document.visibilityState === "visible";
    }
    async pollRemote() {
        if (!this.autoEnabled() || this.busy || this.probing) return;
        const c = this.state.current, watch = this.watch, serial = this.syncSerial;
        const usable = () => this.autoEnabled() && this.watch === watch && this.syncSerial === serial && !this.busy && !this.editTimer;
        this.probing = true;
        try {
            const dav = this.vaultDav(c,this.secret(c,"dav"));
            const sample = await watch.read(dav);
            if (!usable()) return;
            if (this.pollError) {
                this.pollError = "";
                this.settingsTab.refreshStatus();
            }
            if (!watch.changed(sample)) return;
            const names = await dav.list("commits");
            if (!usable()) return;
            const ids = new Set(names);
            if (watch.accepted && ids.size === this.cache.size && [...ids].every(id => this.cache.has(id))) {
                watch.accepted = sample;
                return;
            }
            await this.run(null,true,{sample,names});
        } catch (error) {
            if (usable()) {
                this.pollError = tr("Remote check failed: ","远端检查失败：") + error.message;
                this.settingsTab.refreshStatus();
            }
        } finally { this.probing = false; }
    }
    async requestAuto(force) {
        if (!this.autoEnabled()) return;
        if (force && this.editTimer) { this.autoDue = "check"; return; }
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
    local() { return new VaultFiles(this.app,this.copies); }
    dav(config, password) { return new Dav(config.address, credentials(config.username, password)); }
    vaultDav(config, password) { return this.dav(config,password).child(config.folder).child(core.namespace); }
    initialWindow(config, slot) {
        const limit = concurrencyLevels.includes(config.initialReadLimit) ? config.initialReadLimit : concurrencyLevels[0];
        return new ReadWindow(limit, lowered => {
            const saved = this.state[slot];
            if (!this.closed && saved?.secretId === config.secretId)
                this.save({...this.state, [slot]:{...saved, initialReadLimit:lowered}});
        });
    }
    async connect(config, password, material, reads = new ReadWindow()) {
        const dav = this.vaultDav(config,password);
        const header = core.parseBytes(await reads.one(() => dav.read("vault.json")));
        const key = await core.unlock(header, material, config.id);
        return {store:new core.Store(dav, header.id, key, this.transfer, this.revisions.knownIds(header.id), reads), previous:header.previous};
    }
    async historyStore(id) {
        const c=this.state.current;
        if (this.closed || this.state.pending || !c || c.id!==id) throw Error(tr("Vault changed.","当前库已变化。"));
        return (await this.connect(c,this.secret(c,"dav"),this.secret(c,"key"))).store;
    }
    async rebuildRevisionCache(id) {
        return this.exclusive(async () => {
            const active = () => !this.closed && this.state.current?.id === id;
            this.setProgress("connecting");
            try {
                const store = await this.historyStore(id);
                const known = new Map(this.cache);
                for (const file of this.baseline(id).values()) for (const revision of file.ids) known.set(revision,null);
                const history = await store.history(known, undefined, {refresh:true, active,
                    progress:this.setProgress.bind(this)});
                core.headsByPath(history);
                await this.revisions.save(store, history, active, true);
                // Rebuilding can see newer revisions before their files have been applied.
                // Let the next poll sync them even if the commit list now matches the cache.
                this.watch.accepted = null;
                this.cache = history;
                return history.size;
            } finally { this.setProgress(null); }
        });
    }
    async setHistoryPeriod(id,days) {
        await this.exclusive(async()=>historyTools.setPeriod(await this.historyStore(id),days));
        this.nextHistoryCheck=0;
        this.requestAuto(true);
    }
    openHistory() {
        if (this.historyModal || !this.state.current || this.state.pending) return;
        this.historyModal=new HistoryModal(this,this.state.current.id,this.app.workspace.getActiveFile()?.path);
        this.historyModal.open();
    }
    async restoreHistory(id,preview) {
        await this.exclusive(async()=>{
            const store=await this.historyStore(id);
            await this.watch.trackWrites(store,()=>historyTools.restore({store,local:this.local(),cache:this.cache,
                baseline:this.baseline(id),checkpoint:data=>this.checkpoint(id,data),preview,
                active:()=>!this.closed && this.state.current?.id===id}));
        });
        await this.run(null,true);
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
    setProgress(phase, done = 0, total = null) {
        this.progress = phase && !this.closed ? {phase, done, total} : null;
        this.settingsTab?.refreshProgress?.();
    }
    activate(config, history = new Map()) {
        if (this.closed) throw Error("插件已关闭，请重新打开后继续。");
        const former = this.state.current;
        this.save({current:config});
        if (former && former.secretId !== config.secretId) this.forgetSecrets(former);
        this.cache = history;
        this.restoreStatus();
        this.last = "";
        this.oldFormat = false;
    }

    // Persist the key and target before the first WebDAV write. A lost response or
    // restart can resume the same target without replacing the current binding.
    async startSetup(fields, enteredPassword, onPending) {
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
        const config = {...target, id:core.randomId(), secretId:core.randomId(), auto:true};
        this.storeSecrets(config, core.generateKey(), password);
        this.save({...this.state, pending:config});
        onPending?.();
        return this.resumeSetup();
    }
    async resumeSetup(enteredPassword = "") {
        const config = this.state.pending;
        if (!config) throw Error("没有待完成的建库。");
        const password = enteredPassword || this.secret(config, "dav"), material = this.secret(config, "key");
        if (!password || !material) throw Error("缺少本机保存的建库凭据。");
        const previous = this.state.current?.id || "";
        if (enteredPassword) this.storeSecrets(config, material, password);
        const progress = this.setProgress.bind(this);
        const active = () => !this.closed && this.state.pending?.id === config.id;
        progress("preparingVault");
        try {
            const window = previous ? new ReadWindow() : this.initialWindow(config, "pending");
            await core.createVault(this.dav(config,password), config.folder, material, config.id, previous, window);
            const {store} = await this.connect(config,password,material,window);
            const {baseline,history} = await new VersionWatch().trackWrites(store,
                () => seedSnapshot(store, this.local(), active, progress));
            progress("finishing");
            await this.revisions.save(store, history, active);
            this.checkpoint(config.id, baseline);
            const connected = {...config};
            delete connected.initialReadLimit;
            this.activate(connected, history);
            this.last = tr("Upload and readback verified.","已完成上传和读回校验。");
            this.recordSuccess([]);
            new Notice(this.last);
        } finally { progress(null); }
    }
    async join(fields, material, id) {
        if (this.state.pending) throw Error("请先完成或取消正在进行的建库。");
        sharing.backup(id, material);
        const target = location(fields);
        const password = this.passwordFor(target, fields.password);
        const current = this.state.current;
        const config = {...target, id, secretId:core.randomId(), auto:true};
        this.setProgress("connecting");
        try {
            const window = current ? new ReadWindow() : new ReadWindow(concurrencyLevels[0]);
            const {store, previous} = await this.connect(config, password, material, window);
            let verified;
            if (current?.id !== id) {
                if (current && current.id !== previous) throw Error("当前本地库已绑定另一个库。请打开对应的独立本地库。");
                const options = {progress:this.setProgress.bind(this), active:() => !this.closed};
                const previousCache = await this.revisions.load(id, material);
                verified = await store.history(previousCache, undefined, options);
                await checkJoin(verified, this.local(), current ? this.baseline(current.id) : undefined, options);
                await this.revisions.save(store, verified, options.active);
                if (current) config.joinedFrom = current.id;
                else config.initialReadLimit = store.reads.limit;
            } else {
                verified = this.cache;
                if (current.joinedFrom) config.joinedFrom = current.joinedFrom;
                if (current.initialReadLimit) config.initialReadLimit = current.initialReadLimit;
            }
            if (this.closed) throw Error("插件已关闭，请重新打开后继续。");
            this.storeSecrets(config, material, password);
            this.activate(config, verified);
        } finally { this.setProgress(null); }
    }
    sharingFields() {
        const c = this.state.current;
        return {...c, password:this.secret(c, "dav"), key:this.secret(c, "key")};
    }

    showTransfer(event) {
        if (event && this.closed) return;
        if (event && this.state.pending && ["uploading","readback"].includes(this.progress?.phase)) {
            this.progress.block = {...event};
            this.settingsTab?.refreshProgress();
            return;
        }
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
        this.setProgress(null);
        this.historyModal?.close();
        this.reviewModal?.close();
        clearTimeout(this.editTimer);
        clearTimeout(this.countTimer);
        this.showTransfer(null);
    }

    showNextConflict() {
        if (!this.autoEnabled() || this.busy || this.openingReview || this.reviewModal) return;
        for (const [path, version] of this.conflictVersions) {
            if (this.reviewed.get(path) !== version) {
                void this.openConflict(path);
                return;
            }
        }
    }

    async finishReview(ticket, peer, confirmed = false) {
        // Unloading closes modals too. Let the next live instance recover the saved
        // ticket rather than starting a second asynchronous writer during teardown.
        if (this.closed) return;
        // A comparison opened from saved status may precede the first sync after restart.
        // Leave its ticket for that sync to check before deciding whether to create a copy.
        if (!confirmed && ticket.vaultId === this.state.current?.id && peer &&
            this.conflicts?.includes(peer.path) && this.conflictVersions.get(peer.path) !== ticket.version) return;
        if (ticket.vaultId === this.state.current?.id && peer &&
            this.conflictVersions.get(peer.path) === ticket.version) {
            await this.copies.defer(peer,this.local(),this.cache,ticket.version.split(","));
        }
        const saved = this.app.loadLocalStorage(openReviewKey);
        if (saved?.id === ticket.id && saved.version === ticket.version && saved.vaultId === ticket.vaultId)
            this.app.saveLocalStorage(openReviewKey,null);
    }

    async openConflict(path) {
        if (this.closed || this.openingReview || this.reviewModal) return;
        this.openingReview = true;
        try {
            const review = await this.exclusive(async () => {
                const c = this.state.current;
                if (!c || this.state.pending) throw Error(tr("Finish vault setup first.","请先完成建库。"));
                const {store} = await this.connect(c, this.secret(c,"dav"), this.secret(c,"key"));
                const history = await store.history(this.cache);
                const heads = core.headsByPath(history).get(path) || [];
                if (new Set(heads.map(r => r.hash)).size < 2) throw Error(tr("This conflict changed. Sync again.","冲突已变化，请重新同步。"));
                const local = this.local(), bytes = await local.read(path);
                const readVersion = async rev => {
                    const copy = await this.copies.read(rev);
                    if (copy !== null) return copy;
                    return this.exclusive(() => store.readBody(rev));
                };
                const localHash=bytes===null ? null : await core.sha(bytes);
                const planFor=(peer,left,right)=>isNote(path)
                    ? notePlan(history,heads,localHash,peer.hash,left,right,r=>this.exclusive(()=>store.readMergeBase(r))) : null;
                return {path, vaultId:c.id, heads, headIds:heads.map(r => r.id).sort(), bytes,localHash,readVersion,planFor};
            });
            if (this.closed || this.state.current?.id !== review.vaultId) return;
            const live = review.heads.filter(rev => rev.hash !== null).sort((a,b) => a.id.localeCompare(b.id));
            const peer = live.find(rev => rev.hash !== review.localHash) || live[0];
            const ticket = {vaultId:review.vaultId,id:peer.id,version:review.headIds.join(",")};
            const modal = new ConflictReview(this.app, review, async (source,text,peerId) => {
                if (this.state.current?.id !== review.vaultId || this.closed) throw Error(tr("Vault changed.","当前库已变化。"));
                if (this.busy) throw Error(tr("Sync in progress. Try again.","正在同步，请稍后重试。"));
                const selection = {path, headIds:review.headIds, localHash:review.localHash, source, text, peerId};
                const result = await this.run(selection);
                if (!result) throw Error(this.last);
            }, () => {
                if (this.reviewModal === modal) this.reviewModal = null;
                void this.finishReview(ticket,peer).catch(error => new Notice(error.message))
                    .finally(() => this.showNextConflict());
            });
            this.reviewModal = modal;
            this.app.saveLocalStorage(openReviewKey,ticket);
            modal.open();
            this.reviewed.set(path,review.headIds.join(","));
        } catch (error) {
            this.reviewModal = null;
            if (!this.closed) new Notice(error.message);
        } finally { this.openingReview = false; }
    }

    async run(selection = null, quiet = false, probe = null) {
        if (typeof selection === "string") return this.openConflict(selection);
        if (this.closed || this.busy) return;
        const serial=++this.syncSerial;
        this.syncing = true;
        try {
            const result = await this.exclusive(async () => {
                this.setProgress("connecting");
                this.settingsTab.refreshStatus();
                const c = this.state.current;
                if (this.state.pending) throw Error("请先完成建库或换钥。");
                if (!c) throw Error("请先创建或扫码加入笔记库。");
                const window = concurrencyLevels.includes(c.initialReadLimit) ? this.initialWindow(c, "current") : new ReadWindow();
                const {store} = await this.connect(c, this.secret(c,"dav"), this.secret(c,"key"), window);
                const local = this.local();
                // Sample before listing commits. A post-sync marker could acknowledge
                // a concurrent revision that was never part of this sync.
                const watch = this.watch;
                const sample = probe?.sample ?? await window.one(() => watch.read(store.dav)).catch(() => null);
                const progress = this.setProgress.bind(this), active = () => !this.closed;
                let cache = this.cache;
                let reconciled = 0;
                if (c.joinedFrom) {
                    cache = await store.history(cache, undefined, {progress, active});
                    const updates = await checkJoin(cache, local, this.baseline(c.joinedFrom), {progress, active});
                    for (const {path, hash, target} of updates) {
                        if (this.closed) throw Error("同步已停止。");
                        progress("reconciling", reconciled, updates.length);
                        const body = target && target.hash !== null ? await store.readBody(target) : null;
                        await local.apply(path, hash, body);
                        reconciled++;
                    }
                    // Keep this transition across restarts until all stale files have been reconciled.
                    const updated = {...this.state.current};
                    delete updated.joinedFrom;
                    this.save({current:updated});
                }
                const result = await watch.trackWrites(store, () => core.synchronize({store, local, cache, baseline:this.baseline(c.id),
                    selection, commitNames:c.joinedFrom ? undefined : probe?.names, progress, active, checkpoint:data => this.checkpoint(c.id,data)}));
                progress("finishing");
                result.received += reconciled;
                await this.revisions.save(store, result.history, active);
                this.cache = result.history;
                if (c.initialReadLimit) {
                    const updated = {...this.state.current};
                    delete updated.initialReadLimit;
                    this.save({current:updated});
                }
                watch.accepted = sample;
                if (Date.now()>=this.nextHistoryCheck) {
                    try {
                        const policy=await historyTools.maintain(store,result.history,()=>!this.closed);
                        this.nextHistoryCheck=Date.now()+(policy.pending.length ? 300000 : historyTools.day);
                        this.historyError="";
                    } catch (error) {
                        this.nextHistoryCheck=Date.now()+300000;
                        this.historyError=error.message;
                    }
                }
                const heads = result.conflicts.length ? core.headsByPath(result.history) : new Map();
                this.conflictVersions = new Map(result.conflicts.map(path => [path,heads.get(path).map(r => r.id).sort().join(",")]));
                try {
                    // A mobile suspension or process exit can interrupt dismissal before the copy is written.
                    const ticket = this.app.loadLocalStorage(openReviewKey);
                    if (ticket && !this.reviewModal && !this.openingReview)
                        await this.finishReview(ticket,result.history.get(ticket.id),true);
                    await this.copies.serial(() => this.copies.reconcile(local,result.history,this.conflictVersions));
                } catch (error) {
                    new Notice(tr("Conflict copy maintenance: ","冲突副本整理：") + error.message);
                }
                for (const path of this.reviewed.keys()) if (!this.conflictVersions.has(path)) this.reviewed.delete(path);
                this.last = tr("Uploaded ","已上传 ") + result.sent + tr(" · received "," · 已接收 ") + result.received;
                this.pollError = "";
                if (result.conflicts.length) this.last += "\n" + tr("Unresolved conflicts: ","待处理冲突：") + result.conflicts.length;
                this.recordSuccess(result.conflicts);
                if (!quiet && !result.conflicts.length) new Notice(this.last, 9000);
                return result;
            });
            this.showNextConflict();
            return result;
        } catch (e) {
            this.watch.accepted = null;
            this.last = tr("Sync stopped: ","同步已停止：") + e.message;
            this.syncError = this.last;
            if (!quiet) new Notice(this.last, 10000);
        } finally {
            if (serial===this.syncSerial) {
                this.syncing = false;
                this.setProgress(null);
            }
            this.settingsTab.refreshStatus();
        }
    }
};
