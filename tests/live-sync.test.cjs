"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {EventEmitter, once} = require("node:events");
const {lineDiff, contextRows, textWindow} = require("../src/diff.cjs");
const {VersionWatch} = require("../src/version.cjs");
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
    Plugin:class {}, PluginSettingTab:class {}, Notice:class {}, getLanguage:()=>"en",
    Modal:class {
        constructor(app) { this.app=app; this.contentEl={empty(){}}; }
        open() { this.app.emit("open",this); }
        close() { this.onClose(); }
    }
}));

test("conflict dialogs open in order, can be dismissed, and reopen for a new version", async t => {
    const old=global.document; global.document={visibilityState:"visible"}; t.after(()=>{global.document=old;});
    const p=new compiled.exports(), history=new Map();
    Object.assign(p,{app:new EventEmitter(),ready:true,state:{current:{id:"fixture"}},
        cache:new Map(),conflictVersions:new Map(),reviewed:new Map()});
    const deferred=[];
    const disk=new Map();
    p.app.loadLocalStorage=k=>disk.get(k);
    p.app.saveLocalStorage=(k,v)=>disk.set(k,v);
    p.copies={defer:async rev=>deferred.push(rev.path)};
    p.exclusive=action=>action(); p.secret=()=>"fixture"; p.local=()=>({read:async()=>null});
    p.connect=async()=>({store:{history:async()=>history}});
    function add(path,hash) {
        const id=core.randomId(); history.set(id,{id,parents:[],path,hash});
        p.conflictVersions.set(path,[...history.values()].filter(r=>r.path===path).map(r=>r.id).sort().join(","));
    }
    for (const path of ["a.md","b.md"]) { add(path,"one"); add(path,"two"); }
    const first=once(p.app,"open"); p.showNextConflict(); p.showNextConflict();
    const [a]=await first; assert.equal(a.review.path,"a.md");
    p.showNextConflict(); assert.equal(p.reviewModal,a);
    const second=once(p.app,"open"); a.close();
    const [b]=await second; assert.equal(b.review.path,"b.md");
    assert.deepEqual(deferred,["a.md"]);
    b.close(); await new Promise(setImmediate);
    p.showNextConflict(); assert.equal(p.reviewModal,null);
    add("a.md","three"); const third=once(p.app,"open"); p.showNextConflict();
    const [changed]=await third; assert.equal(changed.review.headIds.length,3);
    changed.close(); await new Promise(setImmediate);
    await p.openConflict("b.md"); assert.equal(p.reviewModal.review.path,"b.md");
    p.reviewModal.close();
});

test("a successful sync closes only a resolved review in this vault, leaving a submitting dialog to finish", () => {
    const p = new compiled.exports();
    p.state = {current:{id:"vault"}};
    p.app = {saveLocalStorage(){}};
    p.settingsTab = {refreshStatus(){}};
    let closes = 0;
    const modal = {review:{vaultId:"vault",path:"a.md"}, close(){closes++; p.reviewModal=null;}};
    p.reviewModal = modal;
    p.recordSuccess(["a.md"]);
    modal.submitting = true;
    p.recordSuccess([]);
    modal.submitting = false;
    modal.review.vaultId = "other";
    p.recordSuccess([]);
    assert.equal(closes,0);
    modal.review.vaultId = "vault";
    p.recordSuccess(["b.md"]);
    p.recordSuccess([]);
    assert.equal(closes,1);
});

test("interrupted comparisons only create a sibling after the same conflict is confirmed", async () => {
    const p = new compiled.exports(), saved = new Map(), deferred = [];
    const peer = {id:"remote",path:"note.md"}, ticket = {id:peer.id,vaultId:"one",version:"local,remote"};
    p.app = {loadLocalStorage:k=>saved.get(k),saveLocalStorage:(k,v)=>saved.set(k,v)};
    p.copies = {defer:async rev=>deferred.push(rev.id)};
    p.local = ()=>({}); p.state = {current:{id:"one"}};
    p.conflictVersions = new Map(); p.conflicts = [peer.path];
    const key = "homebound-personal-v2-open-review";
    saved.set(key,ticket);
    await p.finishReview(ticket,peer);
    assert.equal(saved.get(key),ticket); assert.deepEqual(deferred,[]);
    p.conflictVersions.set(peer.path,ticket.version);
    p.closed=true;
    await p.finishReview(ticket,peer);
    assert.equal(saved.get(key),ticket); assert.deepEqual(deferred,[]);
    p.closed=false;
    await p.finishReview(ticket,peer,true);
    assert.equal(saved.get(key),null); assert.deepEqual(deferred,[peer.id]);
    saved.set(key,ticket); p.conflictVersions.clear(); p.conflicts=[];
    await p.finishReview(ticket,peer,true);
    assert.equal(saved.get(key),null); assert.deepEqual(deferred,[peer.id]);
});

test("probes coalesce coarse timestamps and unsupported collections use a small shared marker", async t => {
    t.mock.timers.enable({apis:["Date"],now:10000});
    const watch=new VersionWatch(), dav={collectionMarker:async()=>({tag:"same second",coarse:true})};
    watch.accepted=await watch.read(dav);
    assert.equal(watch.changed(await watch.read(dav)),false);
    t.mock.timers.tick(2200);
    const settled=await watch.read(dav);
    assert.equal(watch.changed(settled),true);
    watch.accepted=settled;assert.equal(watch.changed(await watch.read(dav)),false);
    let token, discoveries=0;
    const fallback=new VersionWatch(), legacy={
        collectionMarker:async()=>{discoveries++;return null;},
        call:async(method,path)=>{assert.equal(method,"GET");assert.equal(path,"version");return {status:token?200:404,text:token};},
        put:async(path,bytes)=>{assert.equal(path,"version");token=new TextDecoder().decode(bytes);}
    };
    fallback.accepted=await fallback.read(legacy);
    const store={dav:legacy};
    await assert.rejects(fallback.trackWrites(store,async()=>{
        store.lastPublished=core.randomId();throw Error("interrupted after one commit");
    }),/interrupted/);
    assert.equal(fallback.changed(await fallback.read(legacy)),true);
    assert.equal(discoveries,1); assert.equal(token,store.lastPublished);
});

test("steady remote polls only sample metadata; own changes do not start another full sync", async t => {
    const old=global.document;global.document={visibilityState:"visible"};t.after(()=>{global.document=old;});
    const p=new compiled.exports(), id=core.randomId(), peer=core.randomId();
    Object.assign(p,{ready:true,state:{current:{auto:false}},watch:new VersionWatch(),cache:new Map([[id,{}]]),syncSerial:0});
    let tag="v1", list=[id], probes=0, lists=0, runs=0;
    p.secret=()=>"fixture";p.vaultDav=()=>({
        collectionMarker:async()=>{probes++;return {tag};},list:async()=>{lists++;return list;}
    });
    p.watch.accepted={tag};p.run=async(_,quiet,probe)=>{
        assert(quiet);assert.deepEqual(probe.names,[id,peer]);p.watch.accepted=probe.sample;runs++;
    };
    await p.pollRemote();assert.deepEqual([probes,lists,runs],[1,0,0]);
    tag="own-upload";await p.pollRemote();assert.deepEqual([lists,runs],[1,0]);
    tag="peer-upload";list=[id,peer];await p.pollRemote();assert.equal(runs,1);
    document.visibilityState="hidden";await p.pollRemote();assert.equal(probes,3);
    document.visibilityState="visible";p.state.pending={};await p.pollRemote();assert.equal(probes,3);
});

test("vault event debounce coalesces writes, queues edits during sync, and ignores downloaded bytes", async t => {
    t.mock.timers.enable({apis:["setTimeout","setInterval"]});
    const oldWindow=global.window, oldDocument=global.document;
    global.window={setInterval}; global.document={visibilityState:"visible"};
    t.after(()=>{global.window=oldWindow;global.document=oldDocument;});
    const events={}, dom={}, files=new Map(), baseline=new Map();
    const p=new compiled.exports();
    let start, rounds=0;
    const current={id:"fixture",auto:false};
    p.manifest={dir:".obsidian/plugins/homebound-webdav"};
    p.app={appId:"test", secretStorage:{getSecret:()=>null}, vault:{adapter:{exists:async()=>false},on:(event,fn)=>{events[event]=fn;}},
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
    t.mock.timers.tick(1000);events.modify(f);
    t.mock.timers.tick(1999);assert.equal(rounds,1);
    let done=nextRound();t.mock.timers.tick(1);await done;
    await new Promise(setImmediate);
    assert.equal(rounds,2);

    // A vault event emitted by a download matches the new checkpoint.
    events.modify(f);t.mock.timers.tick(2000);
    await p.refreshCount();await new Promise(setImmediate);assert.equal(rounds,2);

    let unlock;
    const syncing=p.exclusive(()=>new Promise(resolve=>{unlock=resolve;}));
    files.set(f.path,data("another edit"));events.modify(f);t.mock.timers.tick(2000);
    assert.equal(rounds,2);done=nextRound();unlock();await syncing;await done;
    await new Promise(setImmediate);
    assert.equal(rounds,3);
    events.modify({path:".obsidian/x"});events.create({path:"Homebound conflicts/x"});
    t.mock.timers.tick(2000);assert.equal(rounds,3);
    document.visibilityState="hidden";dom.visibilitychange();assert.equal(rounds,3);
    document.visibilityState="visible";
    for(const trigger of [dom.visibilitychange,dom.online,()=>t.mock.timers.tick(300000)]) {
        done=nextRound();trigger();await done;await new Promise(setImmediate);
    }
    assert.equal(rounds,6);
    document.visibilityState="hidden";
    files.set("renamed.md",files.get(f.path));files.delete(f.path);
    events.rename({path:"renamed.md"},f.path);
    t.mock.timers.tick(2000);await p.refreshCount();
    assert.deepEqual([...p.uploads.files].sort(),["n.md","renamed.md"]);
    assert.equal(rounds,6);
    events.modify(f);p.onunload();t.mock.timers.tick(2000);assert.equal(rounds,6);
});
