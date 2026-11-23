const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {createRequire} = require("node:module");

test("an open retention dropdown refreshes in place and ignores responses superseded by an edit or a closed tab", async () => {
    const selectEl = {ownerDocument:{visibilityState:"visible"}, isConnected:true,
        getClientRects:()=>[{}], options:[{remove(){}}]};
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
    const source = require.resolve("../src/settings.cjs");
    const localRequire = createRequire(source);
    const settings = {exports:{}};
    const obsidian = {PluginSettingTab:class {}, Modal:class {}, Setting, getLanguage:()=>"en"};
    new Function("module","require",fs.readFileSync(source,"utf8"))(settings,
        name=>name==="obsidian" ? obsidian : localRequire(name));

    const reads=[], writes=[];
    let snapshot={generation:1,days:30};
    const store={readHistoryPolicy:async generation=>{reads.push(generation);return snapshot;}};
    const plugin={state:{current:{id:"vault"}},historyStore:async()=>store,
        setHistoryPeriod:async(id,days)=>writes.push([id,days])};
    const tab=new settings.exports.HomeboundSettings({},plugin);
    tab.showHistory({},"vault");
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
