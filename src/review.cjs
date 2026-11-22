"use strict";

const {Modal, Setting, getLanguage} = require("obsidian");
const {lineDiff, contextRows, textWindow} = require("./diff.cjs");
const {asText} = require("./merge.cjs");
const tr = (en, zh) => getLanguage().startsWith("zh") ? zh : en;
const previewLimit = 256 * 1024;


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
    constructor(app, review, submit, closed) {
        super(app);
        this.review=review;
        this.submit=submit;
        this.closed=closed;
        this.generation=0;
    }
    onOpen() {
        const {path,heads,localHash}=this.review, el=this.contentEl;
        this.setTitle(tr("Resolve conflict","处理冲突"));
        el.addClass("homebound-review");
        el.createEl("p",{text:path,cls:"homebound-review-path"});
        const peers=[...new Map(heads.filter(r=>r.hash!==localHash).map(r=>[r.hash,r])).values()];
        if (peers.length>1) {
            new Setting(el).setName(tr("Remote version","远端版本")).addDropdown(d=>{
                this.picker=d;
                for (const peer of peers) d.addOption(peer.id,peer.id.slice(0,12));
                d.setValue(peers[0].id).onChange(id=>this.preview(peers.find(r=>r.id===id)));
            });
        }
        this.body=el.createDiv();
        this.actions=el.createDiv();
        this.message=el.createDiv({attr:{role:"status"}});
        this.preview(peers[0]);
    }
    async preview(peer) {
        const generation=++this.generation;
        this.selected=peer;
        this.actions.empty();
        this.body.empty();
        this.message.setText(tr("Loading comparison…","正在读取差异…"));
        const {bytes,path,localHash,readVersion,planFor}=this.review;
        try {
            const binaryAttachment=peer.parts && !/\.(md|txt|canvas|json|csv|tsv|yaml|yml|xml|html|css|js|ts|tex|log)$/i.test(path);
            const data=peer.hash===null || binaryAttachment ? null : await readVersion(peer);
            const left=asText(bytes), right=asText(data);
            const parts=await planFor(peer,left,right);
            if (generation!==this.generation) return;
            this.message.empty();
            if (parts && parts.some(p=>typeof p!=="string")) {
                this.reviewRegions(parts);
            } else if (parts) {
                // Another device can finish or change a conflict while the dialog opens.
                await this.choose("merge",parts.join(""));
            } else {
                // Independent creations, deletion vs edit and attachments have
                // no common text to resolve a range against. Choose a whole file.
                const size=peer.parts?.size ?? data?.byteLength;
                for (const [label,hash,n] of [[tr("Local","本地"),localHash,bytes?.byteLength],[tr("Remote","远端"),peer.hash,size]]) {
                    this.body.createEl("p",{cls:"homebound-version",text:label+" · "+describe(hash,n)});
                }
                const editable=!binaryAttachment && (bytes===null || left!==null) && (peer.hash===null || right!==null);
                if (editable) {
                    if ((bytes?.byteLength||0)+(data?.byteLength||0)>previewLimit) drawWindows(this.body.createDiv(),bytes,data);
                    else drawText(this.body,left??"",right??"");
                }
                this.choices(()=>this.choose(peer.id),()=>this.choose("local"),editable ?
                    ()=>this.edit(left??right??"",value=>this.choose("merge",value)) : null);
            }
        } catch (error) {
            if (generation===this.generation) this.message.setText(error.message);
        }
    }
    choices(remote,local,edit) {
        this.actions.empty();
        const controls=new Setting(this.actions);
        controls.addButton(b=>b.setButtonText(tr("Keep remote","保留远端")).onClick(remote));
        controls.addButton(b=>b.setButtonText(tr("Keep local","保留本地")).onClick(local));
        if (edit) controls.addButton(b=>b.setButtonText(tr("Edit","编辑")).onClick(edit));
    }
    reviewRegions(parts) {
        const indices=parts.map((part,i)=>typeof part==="string" ? -1 : i).filter(i=>i>=0);
        const result=parts.slice();
        const show=index=>{
            const position=indices[index], part=parts[position];
            this.body.empty();
            this.body.createEl("p",{text:tr("Conflict ","冲突 ")+(index+1)+" / "+indices.length+
                tr(" · original line "," · 原文第 ")+part.line+tr(""," 行")});
            if (part.context) {
                this.body.createEl("strong",{text:tr("Original line","原文")});
                this.body.createEl("pre",{cls:"homebound-merge-region",text:part.context});
            }
            for (const [label,text,cls] of [[tr("Local","本地"),part.local,"remove"],[tr("Remote","远端"),part.remote,"add"]]) {
                this.body.createEl("strong",{text:label});
                this.body.createEl("pre",{cls:"homebound-merge-region homebound-diff-"+cls,
                    text:text || tr("(deleted)","（已删除）")});
            }
            const take=value=>{
                result[position]=value;
                this.picker?.setDisabled(true);
                if (index+1<indices.length) show(index+1);
                else return this.choose("merge",result.join(""));
            };
            const eol=part.local.match(/\r?\n$/)?.[0];
            const separator=position+1<parts.length && eol && part.remote.endsWith(eol) ? eol : "";
            const draft=separator ? part.local.slice(0,-separator.length) : part.local;
            this.choices(()=>take(part.remote),()=>take(part.local),()=>this.edit(draft,value=>take(value+separator)));
            if (index>0) new Setting(this.actions).addButton(b=>b.setButtonText(tr("Previous","上一处")).onClick(()=>show(index-1)));
        };
        show(0);
    }
    edit(draft,save) {
        this.picker?.setDisabled(true);
        this.actions.empty();
        const label=this.actions.createEl("label",{text:tr("Edit result","编辑结果")});
        const input=label.createEl("textarea",{cls:"homebound-merge-text"});
        input.value=draft;
        const initial=input.value;
        new Setting(this.actions).addButton(b=>b.setCta().setButtonText(tr("Apply edit","采用编辑结果")).onClick(()=>{
            let text=input.value;
            if (text===initial) text=draft;
            else if (draft.includes("\r\n") && !/(^|[^\r])\n/.test(draft)) text=text.replace(/\n/g,"\r\n");
            return save(text);
        }));
        input.focus();
    }
    async choose(source,text) {
        if (this.submitting) return;
        this.submitting=true;
        this.picker?.setDisabled(true);
        const inputs=this.actions.querySelectorAll("button, textarea");
        for (const input of inputs) input.disabled=true;
        this.message.setText(tr("Saving…","正在保存…"));
        try { await this.submit(source,text,this.selected.id); this.close(); }
        catch (error) {
            this.message.setText(error.message);
            for (const input of inputs) input.disabled=false;
        } finally { this.submitting=false; }
    }
    onClose() { this.generation++; this.contentEl.empty(); this.closed?.(); }
}
module.exports = {ConflictReview};
