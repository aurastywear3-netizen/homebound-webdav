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

function lastSyncLabel(time, locale, tr) {
    if (!time) return "";
    const date = new Date(time), language = locale.replace(/_/g,"-");
    const clock = date.toLocaleTimeString(language,{hour:"2-digit",minute:"2-digit"});
    const when = date.toDateString() === new Date().toDateString() ? clock : date.toLocaleDateString(language)+" "+clock;
    return tr("Last synced ","上次同步成功 ")+when;
}

function foregroundStatus(p, online, language, tr) {
    const step = p.progress;
    if (!step && !p.state.current && !p.state.pending) return null;
    if (!online) return {tone:"waiting", label:tr("Offline · waiting for network","离线 · 等待网络")};
    if (step) {
        const block = step.block;
        if (block) {
            const download = step.phase === "readback" ? tr("Verifying blocks","下载分块校验") : tr("Downloading blocks","下载分块");
            const label = block.direction === "upload" ? tr("Uploading blocks","上传分块") : download;
            return {tone:"active", label, count:block.done+" / "+block.total};
        }
        return {tone:"active", label:tr(...progressLabels[step.phase]), count:step.total>0 ? step.done+" / "+step.total : ""};
    }
    if (p.state.pending) return {tone:"waiting", label:p.state.current
        ? tr("Key rotation awaiting verification","换钥待继续校验") : tr("Setup awaiting verification","建库待继续校验")};
    if (p.syncError || p.pollError) return {tone:"issue", label:tr("Sync needs attention","同步遇到问题")};
    if (p.conflicts.length) return {tone:"issue", label:tr("Conflicts to review","待处理冲突"), count:String(p.conflicts.length)};
    if (p.historyError) return {tone:"issue", label:tr("Version history needs attention","版本历史遇到问题")};
    if (p.editTimer || p.autoDue === "edit") return {tone:"waiting", label:tr("Waiting to check changes","等待核对修改")};
    return {tone:"idle", label:lastSyncLabel(p.status.lastSuccess,language,tr) || tr("Waiting for first sync","等待首次同步")};
}

class ForegroundStatus {
    constructor(plugin, mobile, language, tr) {
        this.plugin = plugin;
        this.language = language;
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
        this.label = this.el.createSpan({cls:"homebound-foreground-label",attr:{role:"status"}});
        this.count = this.el.createSpan({cls:"homebound-foreground-count"});
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
        const status = foregroundStatus(this.plugin, this.win.navigator.onLine !== false, this.language(), this.tr);
        this.el.hidden = !status;
        if (!status) return;
        const {tone, label, count = ""} = status;
        if (this.el.dataset.tone !== tone) this.el.dataset.tone = tone;
        if (this.label.textContent !== label) this.label.textContent = label;
        if (this.count.textContent !== count) this.count.textContent = count;
        const title = "Homebound · "+label+(count ? " "+count : "");
        if (this.el.title !== title) this.el.title = title;
    }
    close() {
        if (this.frame != null) this.win.cancelAnimationFrame(this.frame);
        this.el.remove();
    }
}

module.exports = {ForegroundStatus, progressLabels, lastSyncLabel};
