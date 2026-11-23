"use strict";

const {Modal,Setting,Notice,getLanguage}=require("obsidian");
const {snapshot,headIds,digest}=require("./history.cjs");
const {asText}=require("./merge.cjs");
const {textWindow}=require("./diff.cjs");
const {drawText,drawWindows,previewLimit}=require("./review.cjs");
const tr=(en,zh)=>getLanguage().startsWith("zh") ? zh : en;

class HistoryModal extends Modal {
    constructor(plugin,id,path) {
        super(plugin.app);
        this.plugin=plugin;
        this.vaultId=id;
        this.path=path;
        this.generation=0;
    }
    onOpen() {
        this.setTitle(tr("View version history","查看历史版本"));
        this.load();
    }
    async load() {
        const seq=++this.generation, el=this.contentEl;
        el.empty();
        el.createEl("p",{text:tr("Loading history…","正在读取历史版本…")});
        try {
            const p=this.plugin;
            const local=p.local();
            const data=await p.exclusive(async()=>{
                const data=await snapshot(await p.historyStore(this.vaultId),p.cache);
                await local.prepareCopies([this.path].filter(Boolean),data.history);
                return data;
            });
            if (seq!==this.generation) return;
            this.data=data;
            const paths=new Set();
            for (const rev of data.history.values())
                if (rev.hash!==null && data.index.available(rev) && local.allowed(rev.path)) paths.add(rev.path);
            this.paths=[...paths].sort((a,b)=>a.localeCompare(b));
            if (!this.paths.includes(this.path)) this.path=this.paths[0];
            el.empty();
            if (!this.paths.length) { el.createEl("p",{text:tr("No synced files yet.","暂无已同步文件。")}); return; }
            const files=new Setting(el).setName(tr("File","文件"));
            files.addDropdown(d=>{
                for (const path of this.paths) d.addOption(path,path);
                d.setValue(this.path).onChange(path=>{this.path=path;this.showVersions();});
            });
            files.addButton(b=>b.setButtonText(tr("Refresh","刷新")).onClick(()=>this.load()));
            this.versions=el.createDiv();
            this.showVersions();
        } catch (error) {
            if (seq!==this.generation) return;
            el.empty(); el.createEl("p",{text:error.message});
            new Setting(el).addButton(b=>b.setButtonText(tr("Retry","重试")).onClick(()=>this.load()));
        }
    }
    showVersions() {
        this.generation++;
        const {index,history}=this.data, path=this.path, el=this.versions;
        el.empty();
        const heads=new Set(headIds(index.heads.get(path)));
        const revisions=[...history.values()].filter(rev=>rev.path===path && index.available(rev));
        revisions.sort((a,b)=>Number(heads.has(b.id))-Number(heads.has(a.id)) ||
            index.date(b)-index.date(a) || b.id.localeCompare(a.id));
        const controls=new Setting(el).setName(tr("Version","版本"));
        let selected=revisions[0];
        controls.addDropdown(d=>{
            for (const r of revisions) {
                const when=new Date(index.date(r)).toLocaleString();
                const tag=heads.has(r.id) ? tr("Current · ","当前 · ") : "";
                d.addOption(r.id,tag+when+" · "+(r.hash===null ? tr("Deleted · ","已删除 · ") : "")+r.id.slice(0,8));
            }
            d.setValue(selected.id).onChange(id=>{
                selected=history.get(id); this.generation++; this.details.empty();
            });
        });
        controls.addButton(b=>b.setButtonText(tr("Compare changes","比较差异")).onClick(()=>this.compare(selected)));
        this.details=el.createDiv();
    }
    async compare(rev) {
        const p=this.plugin, seq=++this.generation, el=this.details;
        el.empty(); el.createEl("p",{text:tr("Loading comparison…","正在读取差异…")});
        try {
            const {bytes,old,localHash}=await p.exclusive(async()=>{
                const store=await p.historyStore(this.vaultId), bytes=await p.local().read(rev.path);
                const largeBinary=rev.parts && !/\.(md|txt|canvas|json|csv|tsv|yaml|yml|xml|html|css|js|ts|tex|log)$/i.test(rev.path);
                const old=rev.hash===null || largeBinary ? null : await store.readBody(rev);
                return {bytes,old,localHash:await digest(bytes)};
            });
            if (seq!==this.generation) return;
            el.empty();
            const heads=this.data.index.heads.get(rev.path);
            const preview={path:rev.path,revisionId:rev.id,localHash,headIds:headIds(heads)};
            if (localHash===rev.hash) {
                el.createEl("p",{text:tr("This version matches the local file.","此版本与本地文件相同。")}); return;
            }
            if (rev.hash===null) el.createEl("p",{text:tr("This version records a deletion. Restoring it will delete the current file.","此版本记录了一次删除，恢复后将删除当前文件。")});
            if (localHash===null) el.createEl("p",{text:tr("The local file is deleted. Restoring will recreate it.","本地文件已删除，恢复后将重新创建。")});
            const large=(bytes?.byteLength||0)+(old?.byteLength||0)>previewLimit;
            const textLike=(rev.hash===null || old!==null) && [bytes,old].every(data=>
                data===null || asText(large ? textWindow(data,0).slice : data)!==null);
            if (textLike && large) {
                drawWindows(el.createDiv(),bytes,old);
            } else if (textLike) {
                drawText(el,asText(bytes)??"",asText(old)??"");
            } else {
                for (const [label,hash,size] of [[tr("Local","本地"),localHash,bytes?.byteLength],
                    [tr("Selected version","所选版本"),rev.hash,rev.parts?.size??old?.byteLength]]) {
                    el.createEl("p",{cls:"homebound-version",text:label+" · "+
                        (hash===null ? tr("Deleted","已删除") : size+tr(" bytes · SHA-256 "," 字节 · SHA-256 ")+hash)});
                }
            }
            if (this.data.index.conflicts.has(rev.path) || heads[0].hash!==localHash) {
                el.createEl("p",{text:tr("Sync local changes and resolve any conflict before restoring.","请先同步本地改动并处理冲突，再恢复历史版本。")}); return;
            }
            const message=el.createDiv({attr:{role:"status"}});
            new Setting(el).addButton(b=>b.setCta().setButtonText(tr("Restore this version","恢复此版本")).onClick(async()=>{
                b.setDisabled(true);
                try {
                    await p.restoreHistory(this.vaultId,preview);
                    new Notice(tr("Restored as a new version.","已恢复并保存为新版本。"));
                    if (seq===this.generation) this.close();
                } catch (error) {
                    if (seq===this.generation) { message.setText(error.message); b.setDisabled(false); }
                }
            }));
        } catch (error) {
            if (seq===this.generation) { el.empty(); el.createEl("p",{text:error.message}); }
        }
    }
    onClose() {
        this.generation++;
        this.contentEl.empty();
        if (this.plugin.historyModal===this) this.plugin.historyModal=null;
    }
}
module.exports={HistoryModal};
