const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {createRequire} = require("node:module");

function loadTab(Setting) {
    const source=require.resolve("../src/settings.cjs");
    const localRequire=createRequire(source), settings={exports:{}};
    const obsidian={PluginSettingTab:class {}, Modal:class {}, Setting, getLanguage:()=>"en"};
    new Function("module","require",fs.readFileSync(source,"utf8"))(settings,
        name=>name==="obsidian" ? obsidian : localRequire(name));
    return settings.exports.HomeboundSettings;
}

test("the vault summary updates in place and keeps pending work, conflicts and errors visible",()=>{
    let compare,opened;
    class Row {
        setName(){return this;}
        addButton(create){create({setButtonText(){return this;},onClick(fn){compare=fn;}});}
    }
    const HomeboundSettings=loadTab(Row);
    const p={status:{},uploads:{known:false,files:new Set()},conflicts:[],openConflict:path=>{opened=path;}};
    const tab=new HomeboundSettings({},p);
    const label=()=>({setText(value){this.textContent=value;}});
    tab.statusEl={isConnected:true,toggleClass(){}};
    tab.summaryEl=label();tab.detailEl=label();tab.resultEl=label();
    tab.conflictList={empty(){compare=undefined;}};
    tab.refreshStatus();
    assert.match(tab.summaryEl.textContent,/Checking/);
    p.status.lastSuccess=Date.now();p.uploads.known=true;
    tab.refreshStatus();
    assert.match(tab.summaryEl.textContent,/Last synced/);
    assert.equal(tab.detailEl.hidden,true);
    p.uploads.files.add("note.md");tab.refreshStatus();
    assert.match(tab.summaryEl.textContent,/1 file waiting/);
    assert.match(tab.detailEl.textContent,/Last synced/);
    p.conflicts=["conflict.md"];tab.refreshStatus();
    assert.equal(tab.summaryEl.textContent,"1 conflict to review");
    compare();assert.equal(opened,"conflict.md");
    p.syncError="Sync stopped";tab.refreshStatus();
    assert.match(tab.detailEl.textContent,/1 conflict to review.*1 file waiting/);
    assert.equal(tab.resultEl.textContent,"Sync stopped");
    p.syncError="";p.conflicts=[];p.uploads.files.clear();tab.refreshStatus();
    assert.equal(compare,undefined);
    assert.match(tab.summaryEl.textContent,/Last synced/);
    assert.equal(tab.resultEl.hidden,true);
});

test("join confirmation and settings show the current phase and counts and clear on completion or failure",()=>{
    const tab=new (loadTab(class {}))({}, {});
    const view=()=>({el:{isConnected:true},label:{setText(t){this.textContent=t;}},
        bar:{setAttribute(k,v){this[k]=v;},removeAttribute(k){delete this[k];}}});
    tab.joinProgress=view();tab.panelProgress=view();
    const p=tab.plugin;
    p.progress={phase:"connecting",done:0,total:null};tab.refreshProgress();
    assert.equal(tab.joinProgress.el.hidden,false);
    assert.equal(tab.joinProgress.bar.value,undefined);
    p.progress={phase:"versions",done:8,total:10};tab.refreshProgress();
    for (const v of [tab.joinProgress,tab.panelProgress]) {
        assert.equal(v.label.textContent,"Checking remote versions 8 / 10");
        assert.equal(v.bar.max,10);assert.equal(v.bar.value,8);
    }
    tab.joinProgress.el.isConnected=false;
    p.progress={phase:"files",done:3,total:7};tab.refreshProgress();
    assert.equal(tab.panelProgress.label.textContent,"Syncing files 3 / 7");
    assert.equal(tab.joinProgress.bar.value,8);
    p.progress=null;tab.refreshProgress();
    assert.equal(tab.panelProgress.el.hidden,true);
});

test("an open retention dropdown refreshes in place and ignores responses superseded by an edit or a closed tab", async () => {
    const selectEl = {ownerDocument:{visibilityState:"visible"}, isConnected:true,
        setAttribute(){}, getClientRects:()=>[{}], options:[{remove(){}}]};
    const dropdown = {
        value:"", selectEl,
        addOption(){return this;}, setDisabled(){return this;},
        setValue(value){this.value=value;return this;}, getValue(){return this.value;},
        onChange(fn){this.change=fn;return this;}
    };
    class Setting {
        constructor(){this.descEl={};}
        setName(){return this;}
        setDesc(text){this.descEl.textContent=text;return this;}
        addButton(){return this;}
        addDropdown(create){create(dropdown);return this;}
    }
    const reads=[], writes=[];
    let snapshot={generation:1,days:30};
    const store={readHistoryPolicy:async generation=>{reads.push(generation);return snapshot;}};
    const plugin={state:{current:{id:"vault"}},historyStore:async()=>store,
        setHistoryPeriod:async(id,days)=>writes.push([id,days])};
    const HomeboundSettings=loadTab(Setting);
    const tab=new HomeboundSettings({},plugin);
    tab.showHistory({createEl:()=>({addEventListener(){}})},"vault");
    await new Promise(setImmediate);
    assert.equal(dropdown.value,"30");

    let finish;
    snapshot=new Promise(resolve=>{finish=resolve;});
    const inflight=tab.refreshHistoryPeriod();
    await tab.refreshHistoryPeriod();
    assert.deepEqual(reads,[undefined,1]);
    dropdown.setValue("90");
    await dropdown.change("90");
    finish({generation:2,days:60});
    await inflight;
    assert.equal(dropdown.value,"90");

    snapshot={generation:4,days:180};
    selectEl.ownerDocument.visibilityState="hidden";
    await tab.refreshHistoryPeriod();
    assert.equal(reads.length,2);
    selectEl.ownerDocument.visibilityState="visible";
    await tab.refreshHistoryPeriod();
    assert.deepEqual(reads,[undefined,1,undefined]);
    assert.equal(dropdown.value,"180");
    assert.deepEqual(writes,[["vault",90]]);

    snapshot=new Promise(resolve=>{finish=resolve;});
    const closing=tab.refreshHistoryPeriod();
    tab.hide();
    finish({generation:5,days:30});
    await closing;
    assert.equal(tab.refreshHistoryPeriod,null);
    assert.equal(dropdown.value,"180");
});
