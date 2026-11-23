"use strict";
const {Modal, Notice, PluginSettingTab, Setting, getLanguage} = require("obsidian");
const qr = require("./pairing-invite.cjs");
const core = require("./core.cjs");
const {periods}=require("./history.cjs");
const tr = (en, zh) => getLanguage().startsWith("zh") ? zh : en;

function button(el, label, action) {
    return new Setting(el).addButton(b => b.setButtonText(label).onClick(async () => {
        b.setDisabled(true);
        try { await action(); } catch (e) { new Notice(e.message, 10000); }
        finally { b.setDisabled(false); }
    }));
}
function field(el, label, value, change, secret = false) {
    new Setting(el).setClass("homebound-field").setName(label).addText(t => {
        t.inputEl.setAttribute("aria-label",label);
        if (secret) { t.inputEl.type = "password"; t.inputEl.autocomplete = "off"; }
        t.setValue(value).onChange(change);
    });
}

function actionButton(el,label,action,cls) {
    const b=el.createEl("button",{text:label,cls,attr:{type:"button"}});
    b.addEventListener("click",async()=>{
        if (b.disabled) return;
        b.disabled=true;
        try { await action(); } catch (error) { new Notice(error.message,10000); }
        finally { b.disabled=false; }
    });
    return b;
}

function section(el,title) {
    const group=el.createEl("section",{cls:"homebound-section"});
    group.createEl("h3",{text:title});
    return group;
}

function updateText(el,text) {
    if (el.textContent!==text) el.setText(text);
    el.hidden=!text;
}

class DetailModal extends Modal {
    onClose() { this.contentEl.empty(); }
}

function review(app, title, lines, label, action) {
    const modal = new DetailModal(app);
    modal.setTitle(title);
    for (const line of lines) modal.contentEl.createEl("p",{text:line});
    button(modal.contentEl,label,async () => { modal.close(); await action(); });
    modal.open();
}

class Scanner extends DetailModal {
    constructor(app, received) { super(app); this.received = received; }
    accept(fields) {
        if (!this.opened) return;
        this.close();
        this.received(fields);
    }
    onOpen() {
        this.opened = true;
        this.setTitle(tr("Scan a vault code","扫描库共享码"));
        const el = this.contentEl;
        const picker = el.createEl("input",{type:"file"});
        picker.accept = "image/*";
        picker.hidden = true;
        picker.onchange = async () => {
            const file = picker.files[0]; picker.value = "";
            if (file) {
                try { this.accept(await qr.readPhoto(file)); }
                catch (e) { new Notice(e.message); }
            }
        };
        button(el,tr("Choose QR image","选择二维码图片"),() => picker.click());
        const video = el.createEl("video",{cls:"homebound-camera"});
        video.muted = true;
        video.playsInline = true;
        button(el,tr("Open camera","打开摄像头"),async () => {
            if (this.stream) return;
            if (!navigator.mediaDevices?.getUserMedia) {
                picker.setAttribute("capture","environment"); picker.click(); picker.removeAttribute("capture"); return;
            }
            const stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});
            if (!this.opened) { stream.getTracks().forEach(t => t.stop()); return; }
            this.stream = stream;
            video.srcObject = stream;
            try { await video.play(); } catch (e) { this.stopCamera(); throw e; }
            const canvas = document.createElement("canvas");
            const tick = () => {
                if (!this.opened) return;
                try {
                    if (video.videoWidth && video.readyState >= 2) {
                        const result = qr.scanPixels(canvas,video,video.videoWidth,video.videoHeight);
                        if (result) { this.accept(qr.parse(result.data)); return; }
                    }
                } catch (e) { this.stopCamera(); new Notice(e.message); return; }
                this.timer = setTimeout(tick,180);
            };
            tick();
        });
    }
    stopCamera() {
        clearTimeout(this.timer);
        this.stream?.getTracks().forEach(t => t.stop());
        this.stream = null;
    }
    onClose() { this.opened = false; this.stopCamera(); super.onClose(); }
}

class HomeboundSettings extends PluginSettingTab {
    constructor(app, plugin) { super(app,plugin); this.plugin = plugin; }
    async perform(action) {
        try { await this.plugin.exclusive(action); }
        finally { this.display(); }
    }
    reviewJoin(fields,form) {
        const p = this.plugin;
        const lines = [this.app.vault.getName() + " ← " + core.davAddress(fields.address) + "/" + core.directory(fields.folder),
            tr("Vault ID: ","库标识：") + fields.id, tr("After verification, download this vault into the open local vault.",
                "确认后会验证库标识与密钥，并把远端内容同步到当前本地库。")];
        review(this.app,tr("Join this vault?","加入这个库？"),lines,tr("Verify and sync","验证并同步"),async () => {
            await this.perform(() => p.join(fields,fields.key,fields.id));
            form?.close();
            await p.run();
        });
    }
    showBackup(c = this.plugin.state.current) {
        const p = this.plugin;
        const modal = new DetailModal(this.app);
        modal.setTitle(tr("Back up the vault key","备份库密钥"));
        modal.contentEl.createEl("p",{text:tr("Save this key, the address, folder and account in your password manager. Keep the WebDAV password separately available.",
            "将此密钥、下方地址、目录和账号保存到密码管理器，同时保管好 WebDAV 密码。")});
        modal.contentEl.createEl("p",{text:c.address + " · " + c.folder + " · " + c.username});
        const input = modal.contentEl.createEl("textarea",{cls:"homebound-backup"});
        input.value = qr.backup(c.id,p.secret(c,"key")); input.readOnly = true;
        input.onfocus = () => input.select();
        modal.open();
    }
    showCode() {
        const p = this.plugin;
        const payload = qr.create(p.sharingFields());
        const modal = new DetailModal(this.app);
        modal.setTitle(tr("Share this vault","共享当前库"));
        modal.contentEl.createEl("p",{text:tr("Scan inside Homebound on your other device. Anyone who copies this code gets the WebDAV password and this vault key.",
            "请在另一台设备的 Homebound 内扫码。获得此码的人可以使用 WebDAV 账号和本库密钥；截图可重复使用。")});
        qr.draw(modal.contentEl.createEl("canvas",{cls:"homebound-invite-qr"}),payload);
        modal.open();
    }
    statusVisible() { return Boolean(this.statusEl?.isConnected); }
    refreshStatus() {
        if (!this.statusVisible()) return;
        const p = this.plugin;
        const time = p.status.lastSuccess;
        const date=new Date(time);
        let last="";
        if (time) {
            const locale=getLanguage().replace(/_/g,"-");
            const clock=date.toLocaleTimeString(locale,{hour:"2-digit",minute:"2-digit"});
            last=tr("Last synced ","上次同步成功 ")+(date.toDateString()===new Date().toDateString()
                ? clock : date.toLocaleDateString(locale)+" "+clock);
        }
        const count=p.uploads.files.size;
        let queue="";
        if (p.uploads.failed) queue=tr("Upload count unavailable","暂时无法统计待上传文件");
        else if (!p.uploads.known) queue=tr("Checking for local changes…","正在核对本地修改…");
        else if (count) queue=tr(count+(count===1?" file":" files")+" waiting to upload",count+" 个文件待上传");
        const conflicts=p.conflicts.length;
        const conflict=conflicts ? tr(conflicts+(conflicts===1?" conflict":" conflicts")+" to review",conflicts+" 个冲突待处理") : "";
        const error=p.syncError || p.pollError;
        const primary=(error && tr("Sync needs attention","同步遇到问题")) || conflict ||
            (p.syncing && tr("Syncing…","正在同步…")) || queue || last || tr("Waiting for first sync","等待首次同步");
        updateText(this.summaryEl,primary);
        updateText(this.detailEl,[conflict,queue,last].filter(s=>s && s!==primary).join(" · "));
        const historyError=p.historyError && tr("Version history: ","版本历史：")+p.historyError;
        updateText(this.resultEl,[error,historyError].filter(Boolean).join("\n"));
        this.statusEl.toggleClass("has-issue",Boolean(error || conflicts || p.historyError));
        if (this.listedConflicts === p.conflicts) return;
        this.listedConflicts = p.conflicts;
        this.conflictList.empty();
        for (const path of p.conflicts) {
            new Setting(this.conflictList).setName(path).addButton(b => b.setButtonText(tr("Compare","比较差异"))
                .onClick(() => p.openConflict(path)));
        }
    }
    showStatus(el) {
        this.statusEl = el.createEl("section",{cls:"homebound-status"});
        const head=this.statusEl.createDiv({cls:"homebound-overview"});
        const title=head.createDiv({cls:"homebound-vault"});
        title.createEl("h2",{text:this.app.vault.getName()});
        this.summaryEl=title.createDiv({cls:"homebound-summary",attr:{role:"status"}});
        actionButton(head,tr("Sync now","立即同步"),()=>this.plugin.run(),"homebound-sync");
        this.detailEl=this.statusEl.createDiv({cls:"homebound-detail"});
        this.resultEl=this.statusEl.createDiv({cls:"homebound-issue",attr:{role:"status"}});
        this.conflictList = this.statusEl.createDiv();
        this.listedConflicts = null;
        this.refreshStatus();
        this.plugin.scheduleCount();
    }
    showHistory(el,id) {
        const p=this.plugin;
        actionButton(el,tr("View version history","查看历史版本"),()=>p.openHistory(),"homebound-nav");
        const description=tr("Shared by all devices in this vault. The period starts when a version is replaced.",
            "同一库的所有设备共用此设置，旧版本从被替换时开始计时。");
        const label=tr("Keep version history","历史版本保留期限");
        const setting=new Setting(el).setName(label).setDesc(description);
        setting.addDropdown(d=>{
            d.selectEl.setAttribute("aria-label",label);
            d.addOption("",tr("Loading…","读取中…")).setDisabled(true);
            for (const n of periods) d.addOption(String(n),n===0 ? tr("Forever","永久保存") : n+tr(" days"," 天"));
            let store, saved, generation, reading=false, writing=false, edits=0;
            const current=()=>this.refreshHistoryPeriod===refresh && !p.closed && !p.state.pending && p.state.current?.id===id;
            const refresh=async(initial=false)=>{
                const el=d.selectEl;
                if (!current() || reading || writing) return;
                if (!initial && (!el.isConnected || el.ownerDocument.visibilityState==="hidden" || !el.getClientRects().length)) return;
                const edit=edits;
                reading=true;
                try {
                    store ??= await p.historyStore(id);
                    const policy=await store.readHistoryPolicy(generation);
                    if (!current() || edits!==edit) return;
                    if (policy) {
                        if (saved===undefined) el.options[0].remove();
                        saved=policy.days;
                        generation=policy.generation;
                        if (d.getValue()!==String(saved)) d.setValue(String(saved));
                        d.setDisabled(false);
                    }
                    if (setting.descEl.textContent!==description) setting.setDesc(description);
                } catch (error) {
                    store=null;
                    if (current() && edits===edit) setting.setDesc(error.message);
                } finally { reading=false; }
            };
            this.refreshHistoryPeriod=refresh;
            void refresh(true);
            d.onChange(async value=>{
                if (!current() || !value || writing) return;
                edits++;
                writing=true;
                d.setDisabled(true);
                try { await p.setHistoryPeriod(id,Number(value)); saved=Number(value); }
                catch (error) { if (current()) { d.setValue(String(saved)); new Notice(error.message); } }
                finally {
                    writing=false;
                    generation=undefined;
                    if (current()) d.setDisabled(false);
                }
            });
        });
    }
    hide() {
        this.statusEl=null;
        this.refreshHistoryPeriod=null;
        super.hide?.();
    }
    display() {
        this.refreshHistoryPeriod=null;
        this.statusEl=null;
        const p = this.plugin;
        const {current, pending} = p.state;
        this.containerEl.empty();
        this.containerEl.addClass("homebound-settings");
        const el=this.containerEl.createDiv({cls:"homebound-panel"});
        if (pending) {
            this.showPending(el,current,pending);
            return;
        }
        const scan=()=>new Scanner(this.app,f=>this.reviewJoin(f)).open();
        if (!current) {
            el.createEl("h2",{text:this.app.vault.getName()});
            el.createEl("p",{cls:"homebound-intro",text:tr("Connect this vault to sync notes and attachments.",
                "连接此库以同步笔记和附件。")});
            if (p.oldFormat) el.createEl("p",{text:tr("Older vault detected. Finish syncing and backing up with 0.2.2 first. Use a new remote folder to migrate a complete local copy.",
                "检测到旧格式。请先用 0.2.2 同步完整并备份，再从完整本地副本迁移到新的远端空目录。")});
            const actions=el.createDiv({cls:"homebound-start"});
            actionButton(actions,tr("Scan to join","扫码加入"),scan,"mod-cta");
            actionButton(actions,tr("Create new vault","创建新库"),()=>this.connectionForm("create"));
            actionButton(el,tr("Join with a recovery key","使用恢复密钥加入"),()=>this.connectionForm("recover"),"homebound-alternative");
            return;
        }
        this.showStatus(el);
        this.showHistory(section(el,tr("Version history","版本历史")),current.id);
        const devices=section(el,tr("Devices and recovery","设备与恢复"));
        actionButton(devices,tr("Use this vault on another device","在另一台设备上使用此库"),()=>this.showCode(),"homebound-nav");
        actionButton(devices,tr("Back up vault key","备份库密钥"),()=>this.showBackup(),"homebound-nav");

        const advanced=el.createEl("details",{cls:"homebound-advanced"});
        advanced.createEl("summary",{text:tr("Advanced settings","高级设置")});
        advanced.createDiv({cls:"homebound-detail",text:current.address+"/"+current.folder+" · "+current.username});
        actionButton(advanced,tr("Edit WebDAV connection","修改 WebDAV 连接"),()=>this.connectionForm("update"),"homebound-nav");
        actionButton(advanced,tr("Scan to rejoin","重新扫码加入"),scan,"homebound-nav");
        actionButton(advanced,tr("Join with a recovery key","使用恢复密钥加入"),()=>this.connectionForm("recover"),"homebound-nav");
        actionButton(advanced,tr("Rotate key and move to a new folder…","换钥并迁入新目录…"),()=>this.connectionForm("rotate"),"homebound-nav");
        button(advanced,tr("Clear historical copies","清理历史副本"),()=>this.clearCopies())
            .setName(tr("Local conflict copies","本机冲突副本"))
            .setDesc(tr("Remove resolved copies. Pending versions and edited copies are kept.",
                "清理已解决的副本，保留待处理版本和手动编辑过的副本。"));
    }
    async clearCopies() {
        const p=this.plugin;
        const {removed,edited} = await p.exclusive(() =>
            p.copies.serial(() => p.copies.clearHistory(p.conflicts,p.cache,p.conflictVersions)));
        new Notice(tr("Historical copies removed: ","已清理历史副本：") + removed +
            (edited ? tr(" · edited copies kept: "," · 已保留编辑过的副本：") + edited : ""));
    }
    showPending(el,current,pending) {
        const p=this.plugin;
        el.createEl("h2",{text:this.app.vault.getName()});
        el.createEl("p",{text:tr("Setup awaiting verification: ","待完成上传和校验：") + pending.address + "/" + pending.folder});
        let password = "";
        field(el,tr("Updated WebDAV password (optional)","更新后的 WebDAV 密码（可留空）"),"",v => password = v,true);
        button(el,tr("Resume upload and verify","继续上传并校验"),() => this.perform(() => p.resumeSetup(password)));
        button(el,tr("Cancel setup…","取消本次建库…"),() => review(this.app,tr("Cancel setup?","取消本次建库？"),
            [tr("The partial copy stays in its remote folder. Save its recovery key first if you need it. The previous connection will be available again.",
                "新目录中已上传的数据将保留。如需保留其访问能力，请先保存下方恢复密钥。取消后可继续使用原绑定。")],
            tr("Cancel setup","取消本次建库"),() => this.perform(async () => {
                p.save(current ? {current} : {}); p.forgetSecrets(pending);
            })));
        button(el,tr("View pending recovery key","查看待完成库的恢复密钥"),() => this.showBackup(pending));
    }
    connectionForm(mode) {
        const p=this.plugin, current=p.state.current;
        const modal=new DetailModal(this.app);
        const titles={
            create:tr("Create new vault","创建新库"), update:tr("Edit WebDAV connection","修改 WebDAV 连接"),
            rotate:tr("Rotate key and move to a new folder","换钥并迁入新目录"), recover:tr("Join with a recovery key","使用恢复密钥加入")
        };
        modal.setTitle(titles[mode]);
        const form=modal.contentEl;
        form.addClass("homebound-form");
        const draft = {address:current?.address || "", folder:mode==="rotate" ? "" : current?.folder || this.app.vault.getName(),
            username:current?.username || "", password:""};
        field(form,tr("WebDAV HTTPS address","WebDAV HTTPS 地址"),draft.address,v => draft.address = v);
        field(form,mode==="rotate" || mode==="create" ? tr("New, empty remote folder","新的远端空目录") : tr("Remote folder","远端子目录"),draft.folder,v => draft.folder = v);
        field(form,tr("WebDAV username","WebDAV 用户名"),draft.username,v => draft.username = v);
        field(form,current ? tr("WebDAV password (blank keeps current credentials for this account)","WebDAV 密码（同地址、同账号可留空沿用）")
            : tr("WebDAV password","WebDAV 密码"),"",v => draft.password = v,true);
        if (mode==="update") {
            button(form,tr("Verify and save","验证并保存"),async()=>{
                await this.perform(()=>p.join(draft,p.secret(current,"key"),current.id));
                modal.close();
            });
        } else if (mode==="recover") {
            let recovery="";
            field(form,tr("Recovery key","恢复密钥"),"",v=>recovery=v,true);
            button(form,tr("Review and join","核对并加入"),()=>this.reviewJoin({...draft,...qr.recover(recovery)},modal));
        } else button(form,tr("Continue","继续"),() => {
            const lines = [this.app.vault.getName() + " → " + core.davAddress(draft.address) + "/" + core.directory(draft.folder),
                tr("Upload the complete local notes and attachments, then read them back for verification. The new vault starts a fresh revision history.",
                    "将当前本地笔记和附件上传并读回校验。新库从当前内容开始记录版本。")];
            if (current) lines.push(tr("Back up the old vault key to retain access to its history. For a lost device, revoke its WebDAV credentials on the server first. Confirm this local copy includes your latest files and all offline changes you want to keep. Other devices must scan the new code.",
                "请先备份原库密钥，以后读取旧历史时会用到。若设备遗失，请先在服务端撤销旧 WebDAV 凭据。请确认本地副本完整，并已汇集要保留的离线修改。其余设备须重新扫码。"));
            review(this.app,titles[mode],lines,tr("Confirm complete local copy and upload","确认本地副本完整，开始上传"),
                async () => {
                    try { await this.perform(() => p.startSetup(draft,draft.password)); }
                    finally { if (p.state.pending || p.state.current!==current) modal.close(); }
                });
        });
        modal.open();
    }

}
module.exports = {HomeboundSettings};
