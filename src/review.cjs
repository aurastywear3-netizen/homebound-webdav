"use strict";

const {Modal, Setting, getLanguage} = require("obsidian");
const {lineDiff, contextRows, textWindow} = require("./diff.cjs");
const tr = (en, zh) => getLanguage().startsWith("zh") ? zh : en;
const previewLimit = 256 * 1024;

function asText(bytes) {
    if (bytes === null) return "";
    try {
        const text = new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);
        return /[\u0000-\u0008\u000e-\u001f]/.test(text) ? null : text;
    } catch { return null; }
}

function describe(hash, size) {
    if (hash === null) return tr("Deleted","已删除");
    return size + tr(" bytes · SHA-256 "," 字节 · SHA-256 ") + hash;
}

function drawText(el, left, right) {
    const rows = contextRows(lineDiff(left,right));
    el.createEl("p",{text:tr("− Local lines   + Selected lines","− 本机行　+ 所选版本行")});
    const view = el.createDiv({cls:"homebound-diff"});
    let index = 0;
    function more() {
        const end = Math.min(index+400, rows.length);
        for (; index < end; index++) {
            const r = rows[index];
            const prefix = {add:"+ ",remove:"− ",same:"  "}[r.kind];
            const line = r.kind === "gap" ? "… " + r.count + tr(" unchanged lines"," 行相同") :
                prefix + r.text.replace(/\n$/,"").replace(/\r$/," ␍");
            view.createDiv({cls:"homebound-diff-"+r.kind,text:line});
        }
        return index < rows.length;
    }
    if (more()) new Setting(el).addButton(b => b.setButtonText(tr("Show more lines","显示更多行")).onClick(() => {
        if (!more()) b.buttonEl.remove();
    }));
}

function drawWindows(el, left, right) {
    const pages = [{left:0,right:0}];
    const show = index => {
        el.empty();
        const a = textWindow(left,pages[index].left), b = textWindow(right,pages[index].right);
        const x = asText(a.slice), y = asText(b.slice);
        const controls = new Setting(el).setName(tr("Text section ","文本片段 ") + (index+1));
        controls.addButton(btn => btn.setButtonText(tr("Previous","上一段")).setDisabled(index===0).onClick(()=>show(index-1)));
        const hasMore = a.end < (left?.byteLength || 0) || b.end < (right?.byteLength || 0);
        controls.addButton(btn => btn.setButtonText(tr("Next","下一段")).setDisabled(!hasMore).onClick(()=>{
            pages[index+1] = {left:a.end,right:b.end}; show(index+1);
        }));
        if (x === null || y === null) el.createEl("p",{text:tr("This section contains binary data.","此片段包含二进制数据。")});
        else drawText(el,x,y);
    };
    show(0);
}

class ConflictReview extends Modal {
    constructor(app, review, submit) {
        super(app);
        this.review = review;
        this.submit = submit;
        this.generation = 0;
    }
    onOpen() {
        const {path, heads, localHash, bytes} = this.review;
        this.setTitle(tr("Compare conflict","比较冲突版本"));
        const el = this.contentEl;
        el.addClass("homebound-review");
        el.createEl("p",{text:path,cls:"homebound-review-path"});
        const first = heads.find(r => r.hash !== localHash) || heads[0];
        new Setting(el).setName(tr("Compare local file with","与本机文件比较")).addDropdown(d => {
            this.picker = d;
            for (const rev of heads) {
                const label = rev.hash === null ? tr("Deletion","删除版本") : tr("Version","版本");
                d.addOption(rev.id, label + " · " + rev.id.slice(0,12));
            }
            d.setValue(first.id).onChange(id => this.preview(heads.find(r => r.id === id)));
        });
        this.body = el.createDiv();
        this.message = el.createDiv({attr:{role:"status"}});
        new Setting(el).addButton(b => b.setButtonText(tr("Close","关闭")).onClick(() => this.close())).addButton(b => {
            this.localButton = b.setButtonText(bytes === null ? tr("Keep local deletion","保留本机删除") : tr("Keep local file","保留本机文件"))
                .onClick(() => this.choose("local"));
        }).addButton(b => { this.remoteButton = b.setCta().onClick(() => this.choose(this.selected.id)); });
        this.preview(first);
    }
    async preview(rev) {
        const generation = ++this.generation;
        const {bytes, localHash, readVersion} = this.review;
        this.selected = rev;
        this.body.empty();
        this.localButton.setDisabled(true);
        this.remoteButton.setDisabled(true).setButtonText(rev.hash === null ? tr("Use selected deletion","采用所选删除版本") : tr("Use selected file","采用所选文件"));
        this.message.setText(tr("Loading comparison…","正在读取差异…"));
        try {
            let remote = null, size = rev.parts?.size;
            if (rev.hash !== null && size === undefined) {
                remote = rev.hash === localHash ? bytes : await readVersion(rev);
                size = remote.byteLength;
            }
            if (generation !== this.generation) return;
            for (const [label,hash,n] of [[tr("Local","本机"),localHash,bytes?.byteLength],[tr("Selected","所选版本"),rev.hash,size]]) {
                const p = this.body.createEl("p",{cls:"homebound-version"});
                p.createEl("strong",{text:label + " · "});
                p.createSpan({text:describe(hash,n)});
            }
            if (rev.hash === localHash) {
                this.body.createEl("p",{text:tr("Identical content.","内容相同。")});
            } else {
                const large = (bytes?.byteLength || 0) > previewLimit || size > previewLimit;
                const left = large ? null : asText(bytes), right = large ? null : asText(remote);
                if (large && /\.(md|txt|canvas|json|csv|tsv|yaml|yml|xml|html|css|js|ts|tex|log)$/i.test(rev.path)) {
                    const section = this.body.createDiv();
                    new Setting(section).addButton(b => b.setButtonText(tr("Compare text in sections","分段比较文本")).onClick(async () => {
                        b.setDisabled(true);
                        try {
                            const data = rev.parts ? await readVersion(rev) : remote;
                            if (generation === this.generation) drawWindows(section,bytes,data);
                        } catch (error) {
                            if (generation === this.generation) { this.message.setText(error.message); b.setDisabled(false); }
                        }
                    }));
                } else if (left === null || right === null) {
                    this.body.createEl("p",{text:tr("Compare file sizes and SHA-256 above.","可通过上方的大小和 SHA-256 比较文件。")});
                } else {
                    drawText(this.body,left,right);
                    if (bytes !== null && remote !== null && left.endsWith("\n") !== right.endsWith("\n")) {
                        this.body.createEl("p",{text:left.endsWith("\n") ? tr("Only the local file ends with a newline.","仅本机文件以换行结束。")
                            : tr("Only the selected file ends with a newline.","仅所选版本以换行结束。")});
                    }
                }
            }
            this.message.empty();
            this.localButton.setDisabled(false);
            this.remoteButton.setDisabled(false);
        } catch (error) {
            if (generation === this.generation) this.message.setText(error.message);
        }
    }
    async choose(source) {
        this.localButton.setDisabled(true);
        this.remoteButton.setDisabled(true);
        this.picker.setDisabled(true);
        this.message.setText(tr("Resolving…","正在提交…"));
        try { await this.submit(source); this.close(); }
        catch (e) { this.message.setText(e.message + " " + tr("Close and compare again.","请关闭窗口后重新比较。")); }
    }
    onClose() { this.generation++; this.contentEl.empty(); }
}
module.exports = {ConflictReview};
