"use strict";

const progressLabels={
    loadingLocal:["Loading local sync records…","正在读取本机同步记录…"],
    preparingVault:["Preparing the remote vault…","正在准备远端库…"],
    existingVersions:["Reading existing remote versions","读取远端已有版本"],
    uploading:["Uploading local files to WebDAV","上传本地文件到 WebDAV"],
    resumingFiles:["Checking files and uploading changes","比对文件并补传差异"],
    readback:["Downloading files from WebDAV for verification","从 WebDAV 下载并校验文件"],
    connecting:["Verifying connection and vault key…","正在验证连接和库密钥…"],
    versions:["Checking remote versions","核对远端版本"],
    local:["Checking local files","核对本地文件"],
    reconciling:["Updating files after key rotation","更新换钥后的文件"],
    files:["Syncing files","同步文件"],
    finishing:["Finishing sync…","正在完成同步…"]
};

const lightLabels = {
    idle:["Synced","已同步"],
    waiting:["Waiting to sync","等待同步"],
    active:["Syncing","同步中"],
    issue:["Needs attention","需处理"]
};

function lastSyncLabel(time, locale, tr) {
    if (!time) return "";
    const date = new Date(time), language = locale.replace(/_/g,"-");
    const clock = date.toLocaleTimeString(language,{hour:"2-digit",minute:"2-digit"});
    const when = date.toDateString() === new Date().toDateString() ? clock : date.toLocaleDateString(language)+" "+clock;
    return tr("Last synced ","上次同步成功 ")+when;
}

function foregroundTone(p, online) {
    const active = p.progress || p.transferBlock;
    if (!active && !p.state.current && !p.state.pending) return null;
    if (!online) return "waiting";
    if (active) return "active";
    if (p.state.pending || p.syncError || p.pollError || p.conflicts.length || p.historyError) return "issue";
    if (p.editTimer || p.autoDue === "edit" || !p.status.lastSuccess) return "waiting";
    return "idle";
}

class ForegroundStatus {
    constructor(plugin, mobile, tr) {
        this.plugin = plugin;
        this.tr = tr;
        const workspace = plugin.app.workspace;
        if (mobile) {
            this.el = workspace.containerEl.ownerDocument.createElement("div");
            this.el.classList.add("homebound-mobile-status");
            const attach = () => {
                const host = workspace.getMostRecentLeaf(workspace.rootSplit)?.view.containerEl;
                if (host && this.el.parentElement !== host) host.append(this.el);
            };
            for (const event of ["active-leaf-change","layout-change","file-open"])
                plugin.registerEvent(workspace.on(event,attach));
            attach();
        } else this.el = plugin.addStatusBarItem();
        this.win = this.el.ownerDocument.defaultView;
        this.el.classList.add("homebound-foreground");
        this.el.setAttribute("role","img");
        this.el.createSpan({cls:"homebound-status-dot",attr:{"aria-hidden":"true"}});
        this.render();
    }
    refresh() {
        if (this.frame != null || this.plugin.closed) return;
        this.frame = this.win.requestAnimationFrame(() => {
            this.frame = null;
            this.render();
        });
    }
    render() {
        const tone = foregroundTone(this.plugin, this.win.navigator.onLine !== false);
        this.el.hidden = !tone;
        if (!tone) return;
        const label = "Homebound · "+this.tr(...lightLabels[tone]);
        if (this.el.dataset.tone !== tone) this.el.dataset.tone = tone;
        if (this.el.getAttribute("aria-label") !== label) this.el.setAttribute("aria-label",label);
    }
    close() {
        if (this.frame != null) this.win.cancelAnimationFrame(this.frame);
        this.el.remove();
    }
}

module.exports = {ForegroundStatus, progressLabels, lastSyncLabel};
