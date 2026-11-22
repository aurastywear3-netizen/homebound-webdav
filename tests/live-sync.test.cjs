"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {lineDiff, contextRows, textWindow} = require("../src/diff.cjs");
const {PendingUploads} = require("../src/pending.cjs");
const core = require("../src/core.cjs");

test("line diff preserves text and line endings, limits unchanged context, and handles large replacements", () => {
    const common = Array.from({length:100}, (_,i)=>i+"\n").join("");
    for (const [a,b] of [["",""],["","\n"],["a\r\n","a\n"],["one\n","one"],[common+"old\nend",common+"new\nend"],
        ["a\n".repeat(900),"b\n".repeat(900)]]) {
        const rows = lineDiff(a,b);
        assert.equal(rows.filter(r=>r.kind!=="add").map(r=>r.text).join(""),a);
        assert.equal(rows.filter(r=>r.kind!=="remove").map(r=>r.text).join(""),b);
    }
    const shown = contextRows(lineDiff(common+"old\nend",common+"new\nend"));
    assert(shown.some(r=>r.kind==="gap" && r.count===94));
    assert.deepEqual(shown.filter(r=>["remove","add"].includes(r.kind)).map(r=>r.text),["old\n","new\n"]);
});

const data = text => new TextEncoder().encode(text).buffer;
test("large note windows preserve UTF-8 across long lines and allow all later differences to be visited", () => {
    const original = "汉😊".repeat(25000) + "\n" + "short\n".repeat(500) + "末行";
    const bytes = data(original);
    let offset=0, rebuilt="", pages=0;
    while (offset < bytes.byteLength) {
        const part = textWindow(bytes,offset);
        assert(part.end > offset && part.slice.byteLength <= 65536);
        rebuilt += new TextDecoder("utf-8",{fatal:true}).decode(part.slice);
        offset=part.end;
        pages++;
    }
    assert(pages>3);
    assert.equal(rebuilt,original);
    assert.equal(textWindow(null,0).slice.byteLength,0);
});

test("local upload count reconstructs offline edits, additions and deletions and clears reverted changes", async () => {
    const pending = new PendingUploads();
    const files = new Map([["same",data("old")],["edited",data("new")],["added",data("new")],[".hidden",data("no")]]);
    const old = await core.sha(data("old"));
    const baseline = new Map(["same","edited","deleted"].map(path=>[path,{hash:old}]));
    const local = {paths:()=>files.keys(), read:async path=>files.get(path)??null, allowed:path=>!path.startsWith(".")};
    const refresh = ()=>pending.refresh(local,()=>baseline,()=>true);
    await refresh();
    assert.deepEqual([...pending.files].sort(),["added","deleted","edited"]);
    files.set("edited",data("old"));
    files.delete("added");
    pending.candidates.add("added"); pending.candidates.add("edited");
    await refresh();
    assert.deepEqual([...pending.files],["deleted"]);
});

const compiled = {exports:{}};
new Function("module","require",fs.readFileSync(require.resolve("../main.js"),"utf8"))(compiled,()=>({
    Plugin:class {}, PluginSettingTab:class {}, Modal:class {}, Notice:class {}, getLanguage:()=>"en"
}));

test("vault event debounce coalesces writes, queues edits during sync, and ignores downloaded bytes", async t => {
    t.mock.timers.enable({apis:["setTimeout","setInterval"]});
    const oldWindow=global.window, oldDocument=global.document;
    global.window={setInterval}; global.document={visibilityState:"visible"};
    t.after(()=>{global.window=oldWindow;global.document=oldDocument;});
    const events={}, dom={}, files=new Map(), baseline=new Map();
    const p=new compiled.exports();
    let start, rounds=0;
    const current={id:"fixture",auto:true};
    p.app={appId:"test", vault:{on:(event,fn)=>{events[event]=fn;}},
        workspace:{onLayoutReady:fn=>{start=fn;}},loadLocalStorage:k=>k==="homebound-personal-v2"?{current}:null};
    p.loadData=async()=>null;
    p.addSettingTab=p.addCommand=p.registerInterval=p.registerEvent=()=>{};
    p.registerDomEvent=(_,event,fn)=>{dom[event]=fn;};
    p.local=()=>({paths:()=>files.keys(),read:async path=>files.get(path)??null,
        allowed:path=>!path.startsWith(".")&&!core.isRecovery(path)});
    p.baseline=()=>baseline;
    let complete;
    const nextRound=()=>new Promise(resolve=>{complete=resolve;});
    p.run=async()=>p.exclusive(async()=>{
        rounds++;
        for(const [path,bytes] of files) baseline.set(path,{hash:await core.sha(bytes)});
        complete?.();
    });
    await p.onload();
    start();
    assert.equal(rounds,1);
    await new Promise(setImmediate);
    const f={path:"n.md"};
    files.set(f.path,data("edit"));events.create(f);
    t.mock.timers.tick(3000);events.modify(f);
    t.mock.timers.tick(3999);assert.equal(rounds,1);
    let done=nextRound();t.mock.timers.tick(1);await done;
    await new Promise(setImmediate);
    assert.equal(rounds,2);

    // A vault event emitted by a download matches the new checkpoint.
    events.modify(f);t.mock.timers.tick(4000);
    await p.refreshCount();await new Promise(setImmediate);assert.equal(rounds,2);

    let unlock;
    const syncing=p.exclusive(()=>new Promise(resolve=>{unlock=resolve;}));
    files.set(f.path,data("another edit"));events.modify(f);t.mock.timers.tick(4000);
    assert.equal(rounds,2);done=nextRound();unlock();await syncing;await done;
    await new Promise(setImmediate);
    assert.equal(rounds,3);
    events.modify({path:".obsidian/x"});events.create({path:"Homebound conflicts/x"});
    t.mock.timers.tick(4000);assert.equal(rounds,3);
    document.visibilityState="hidden";dom.visibilitychange();assert.equal(rounds,3);
    document.visibilityState="visible";
    for(const trigger of [dom.visibilitychange,dom.online,()=>t.mock.timers.tick(300000)]) {
        done=nextRound();trigger();await done;await new Promise(setImmediate);
    }
    assert.equal(rounds,6);
    document.visibilityState="hidden";
    files.set("renamed.md",files.get(f.path));files.delete(f.path);
    events.rename({path:"renamed.md"},f.path);
    t.mock.timers.tick(4000);await p.refreshCount();
    assert.deepEqual([...p.uploads.files].sort(),["n.md","renamed.md"]);
    assert.equal(rounds,6);
    events.modify(f);p.onunload();t.mock.timers.tick(4000);assert.equal(rounds,6);
});
