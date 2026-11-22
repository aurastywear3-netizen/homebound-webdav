"use strict";
const {Modal, Notice, PluginSettingTab, Setting, getLanguage} = require("obsidian");
const qr = require("./pairing-invite.cjs");
const core = require("./core.cjs");
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
        if (secret) { t.inputEl.type = "password"; t.inputEl.autocomplete = "off"; }
        t.setValue(value).onChange(change);
    });
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
    reviewJoin(fields) {
        const p = this.plugin;
        const lines = [this.app.vault.getName() + " ← " + core.davAddress(fields.address) + "/" + core.directory(fields.folder),
            tr("Vault ID: ","库标识：") + fields.id, tr("After verification, download this vault into the open local vault.",
                "确认后会验证库标识与密钥，并把远端内容同步到当前本地库。")];
        review(this.app,tr("Join this vault?","加入这个库？"),lines,tr("Verify and sync","验证并同步"),async () => {
            await this.perform(() => p.join(fields,fields.key,fields.id));
            await p.run();
            this.display();
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
    display() {
        const p = this.plugin, el = this.containerEl;
        const {current, pending} = p.state;
        el.empty(); el.addClass("homebound-settings");
        if (pending) {
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
            return;
        }
        if (p.oldFormat) el.createEl("p",{text:tr("Older vault detected. Finish syncing and backing up with 0.2.2 first. Use a new remote folder to migrate a complete local copy.",
            "检测到旧格式。请先用 0.2.2 同步完整并备份，再从完整本地副本迁移到新的远端空目录。")});
        el.createEl("p",{text:tr("Syncs notes and attachments in this vault. Hidden files, empty folders and Obsidian settings are excluded.",
            "同步当前库的笔记和附件。隐藏文件、空目录和 Obsidian 配置目录会跳过。")});
        if (current) {
            el.createEl("p",{text:current.address + "/" + current.folder + " · " + current.username});
            button(el,tr("Sync now","立即同步"),async () => { await p.run(); this.display(); });
            new Setting(el).setName(tr("Sync while open","打开期间自动同步")).addToggle(t => t.setValue(Boolean(current.auto))
                .onChange(value => { if (p.state.current === current && !p.state.pending) p.save({current:{...current,auto:value}}); }));
            button(el,tr("Show sharing QR code","显示共享二维码"),() => this.showCode());
            button(el,tr("Back up vault key","备份库密钥"),() => this.showBackup());
            if (p.last) el.createEl("p",{text:p.last});
        }
        button(el,tr("Scan to join","扫码加入"),() => new Scanner(this.app,f => this.reviewJoin(f)).open());

        const form = el.createEl("details");
        form.open = !current;
        form.createEl("summary",{text:tr("WebDAV configuration and recovery","WebDAV 配置与恢复")});
        const draft = {address:current?.address || "", folder:current?.folder || this.app.vault.getName(),
            username:current?.username || "", password:""};
        field(form,tr("WebDAV HTTPS address","WebDAV HTTPS 地址"),draft.address,v => draft.address = v);
        field(form,tr("Remote folder","远端子目录"),draft.folder,v => draft.folder = v);
        field(form,tr("WebDAV username","WebDAV 用户名"),draft.username,v => draft.username = v);
        field(form,current ? tr("WebDAV password (blank keeps current credentials for this account)","WebDAV 密码（同地址、同账号可留空沿用）")
            : tr("WebDAV password","WebDAV 密码"),"",v => draft.password = v,true);
        if (current) button(form,tr("Verify and update WebDAV credentials","验证并更新 WebDAV 配置"),
            () => this.perform(() => p.join(draft,p.secret(current,"key"),current.id)));
        const create = current ? tr("Rotate vault key…","换钥并迁入新目录…") : tr("Create encrypted vault…","创建加密库…");
        button(form,create,() => {
            const lines = [this.app.vault.getName() + " → " + core.davAddress(draft.address) + "/" + core.directory(draft.folder),
                tr("Upload the complete local notes and attachments, then read them back for verification. The new vault starts a fresh revision history.",
                    "将当前本地笔记和附件上传并读回校验。新库从当前内容开始记录版本。")];
            if (current) lines.push(tr("Back up the old vault key to retain access to its history. For a lost device, revoke its WebDAV credentials on the server first. Confirm this local copy includes your latest files and all offline changes you want to keep. Other devices must scan the new code.",
                "请先备份原库密钥，以后读取旧历史时会用到。若设备遗失，请先在服务端撤销旧 WebDAV 凭据。请确认本地副本完整，并已汇集要保留的离线修改。其余设备须重新扫码。"));
            review(this.app,create,lines,tr("Confirm complete local copy and upload","确认本地副本完整，开始上传"),
                () => this.perform(() => p.startSetup(draft,draft.password)));
        });
        let recovery = "";
        field(form,tr("Recovery key","恢复密钥"),"",v => recovery = v,true);
        button(form,tr("Join using recovery key…","使用恢复密钥加入…"),() => this.reviewJoin({...draft,...qr.recover(recovery)}));
    }

}
module.exports = {HomeboundSettings};
