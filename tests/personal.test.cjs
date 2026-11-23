"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const core = require("../src/core.cjs");
const sharing = require("../src/pairing-invite.cjs");

const bundle = fs.readFileSync(require.resolve("../main.js"),"utf8");
const moduleShim = {exports:{}};
new Function("module","require",bundle)(moduleShim,() => ({
    Plugin:class {}, PluginSettingTab:class {}, Modal:class {}, Notice:class {}, getLanguage:() => "zh"
}));
const Plugin = moduleShim.exports;
const bytes = text => new TextEncoder().encode(text).buffer;

function server() {
    const files = new Map(), dirs = new Set([""]);
    const dav = {password:"fixture-one",failRead:false,requests:0,writes:0,hidden:new Set()};
    class Directory {
        constructor(root, password) { this.root = root; this.password = password; }
        child(name) { return new Directory(this.root+"/"+name,this.password); }
        auth() {
            dav.requests++;
            if (this.password !== dav.password) throw Error("401");
        }
        async mkdir(name) {
            this.auth();
            const path = this.child(name).root;
            if (dirs.has(path)) throw Object.assign(Error("exists"),{status:405});
            dirs.add(path);
        }
        async list(path) {
            this.auth();
            const prefix = (path ? this.child(path).root : this.root)+"/";
            return [...dirs,...files.keys()].filter(k => k.startsWith(prefix))
                .map(k => k.slice(prefix.length)).filter(k => !k.includes("/") && (path !== "commits" || !dav.hidden.has(k)));
        }
        async read(name) {
            this.auth();
            if (dav.onRead) await dav.onRead(name);
            if (dav.failRead && name.startsWith("objects/b-")) throw Error("readback interrupted");
            const value = files.get(this.child(name).root);
            if (!value) throw Object.assign(Error("absent"),{status:404});
            return value;
        }
        async put(name, content) { this.auth(); dav.writes++; files.set(this.child(name).root,content); }
        async call(method, name, codes, {headers}) {
            this.auth(); assert.equal(method,"MOVE"); assert.equal(headers.Overwrite,"F");
            const from = this.child(name).root, to = headers.Destination;
            assert(!dirs.has(to));
            for (const dir of [...dirs]) if (dir === from || dir.startsWith(from+"/")) {
                dirs.delete(dir); dirs.add(to+dir.slice(from.length));
            }
            for (const [path, content] of [...files]) if (path.startsWith(from+"/")) {
                files.delete(path); files.set(to+path.slice(from.length),content);
            }
        }
    }
    dav.root = password => new Directory("",password);
    return dav;
}

async function device(remote, contents = new Map(), disk = new Map(), secrets = new Map(), legacy = {}) {
    const p = new Plugin();
    p.manifest = {dir:".obsidian/plugins/homebound-webdav"};
    const adapter = {
        exists:async path=>disk.has(path),
        writeBinary:async (path, data)=>disk.set(path, data.slice(0)),
        readBinary:async path=>{
            if (!disk.has(path)) throw Error("file absent");
            return disk.get(path).slice(0);
        },
        remove:async path=>disk.delete(path)
    };
    p.app = {appId:"test",vault:{getName:()=>"Vault",adapter,getAbstractFileByPath:()=>null},workspace:{onLayoutReady(){}},
        loadLocalStorage:k=>structuredClone(disk.get(k)),saveLocalStorage:(k,v)=>disk.set(k,structuredClone(v)),
        secretStorage:{getSecret:k=>secrets.get(k),setSecret:(k,v)=>secrets.set(k,v)}};
    p.loadData = async () => legacy;
    p.addCommand = p.addSettingTab = p.registerDomEvent = p.registerInterval = () => {};
    p.dav = (_,pw) => remote.root(pw);
    p.local = () => ({paths:()=>new Set(contents.keys()),allowed:path=>core.safePath(path),
        read:async path=>contents.get(path) ?? null,
        apply:async (path, original, data)=>{
            const previous = contents.get(path);
            assert.equal(previous ? await core.sha(previous) : null, original);
            if (data === null) contents.delete(path); else contents.set(path,data);
        }});
    await p.onload();
    return p;
}

test("built plugin creates independent vaults, shares one key, rotates after loss and resumes verified migration", async () => {
    const prior = {window:global.window,document:global.document};
    global.window = {setInterval:()=>0}; global.document = {};
    try {
        const srv = server(), disk = new Map(), secrets = new Map();
        const source = new Map([["私人/笔记.md",bytes("original")],["附件.bin",Uint8Array.of(7,9,0).buffer]]);
        let mac = await device(srv,source,disk,secrets,{id:"legacy",auto:true});
        assert.equal(mac.oldFormat,true); assert.equal(srv.requests,0);
        const loc = {address:"https://dav.example",folder:"个人/笔记",username:"personal"};
        await mac.startSetup(loc,srv.password);
        const original = sharing.parse(sharing.create(mac.sharingFields()));
        const ipadFiles = new Map(), ipad = await device(srv,ipadFiles);
        await ipad.join(original,original.key,original.id);
        assert.equal((await ipad.run()).received,2);
        assert.deepEqual(ipadFiles,source);
        ipadFiles.set("iPad.md",bytes("reverse"));
        assert.equal((await ipad.run()).sent,1);
        assert.equal((await mac.run()).received,1);
        const second = await device(srv);
        await second.startSetup({...loc,folder:"IELTS"},srv.password);
        assert.notEqual(second.sharingFields().key,original.key);
        await assert.rejects(ipad.join(second.sharingFields(),second.sharingFields().key,second.state.current.id),/另一个库/);
        for (const value of disk.values()) {
            assert(!JSON.stringify(value).includes(original.key));
            assert(!JSON.stringify(value).includes(original.password));
        }
        // This peer remains offline while the up-to-date source edits and deletes files.
        source.set("私人/笔记.md",bytes("Mac change while iPad offline"));
        source.delete("附件.bin");
        source.set("替代附件.bin",Uint8Array.of(99).buffer);
        await mac.run();
        srv.password = "fixture-two";
        await assert.rejects(ipad.connect(original,original.password,original.key),/401/);
        srv.failRead = true;
        const rotatedLoc = {...loc,folder:"个人/新库"};
        await assert.rejects(mac.startSetup(rotatedLoc,srv.password),/readback/);
        assert.equal(mac.state.current.id,original.id);
        const pendingId = mac.state.pending.id;
        mac = await device(srv,source,disk,secrets);
        assert.equal(mac.state.pending.id,pendingId); assert.equal(await mac.run(),undefined);
        srv.failRead = false;
        await mac.resumeSetup();
        const next = sharing.parse(sharing.create(mac.sharingFields()));
        assert.equal(next.id,pendingId); assert.notEqual(next.key,original.key);
        await assert.rejects(mac.connect(next,next.password,original.key),/校验失败/);
        await assert.rejects(mac.connect({...next,id:original.id},next.password,next.key),/不匹配/);
        await mac.connect(original,srv.password,original.key);
        ipadFiles.set("离线.md",bytes("unsynced"));
        await assert.rejects(ipad.join(next,next.key,next.id),/离线.md/);
        assert.equal(ipad.state.current.id,original.id);
        ipadFiles.delete("离线.md");
        await ipad.join(next,next.key,next.id);
        assert.equal((await ipad.run()).sent,0);
        assert.deepEqual(ipadFiles,source);
        const restored = await device(srv);
        const recovery = sharing.recover(sharing.backup(next.id,next.key));
        await restored.join({...rotatedLoc,password:srv.password},recovery.key,recovery.id);
        assert.equal((await restored.run()).received,3);
        const otherKey = second.sharingFields().key, otherId = second.state.current.id;
        await second.join({...loc,folder:"IELTS",password:srv.password},otherKey,otherId);
        assert.equal(second.sharingFields().key,otherKey);
        const wrong = await device(srv);
        await assert.rejects(wrong.startSetup(loc,srv.password),/不匹配/);
        await mac.connect(next,next.password,next.key);
    } finally { Object.assign(global,prior); }
});

test("a failed sync and a restart preserve the last completed sync and conflict list for this vault", async () => {
    const prior = {window:global.window,document:global.document};
    global.window = {setInterval:()=>0};
    global.document = {createDocumentFragment:()=>({append(){}}), createElement:()=>({addEventListener(){}})};
    try {
        const srv=server(), disk=new Map(), secrets=new Map(), files=new Map([["note.md",bytes("original")]]);
        const mac=await device(srv,files,disk,secrets);
        await mac.startSetup({address:"https://dav.example",folder:"sync",username:"tester"},srv.password);
        const config=mac.state.current;
        const {store}=await mac.connect(config,srv.password,mac.secret(config,"key"));
        await store.publish("note.md",mac.baseline(config.id).get("note.md").ids,bytes("remote"));
        files.set("note.md",bytes("local"));
        const local=mac.local();
        mac.local=()=>({...local,archive:async()=>{}});
        assert.deepEqual((await mac.run()).conflicts,["note.md"]);
        const success=mac.status.lastSuccess;
        srv.password="rotated-password";
        assert.equal(await mac.run(),undefined);
        assert.equal(mac.status.lastSuccess,success);
        const restored=await device(srv,files,disk,secrets);
        assert.equal(restored.status.lastSuccess,success);
        assert.deepEqual(restored.conflicts,["note.md"]);
    } finally { Object.assign(global,prior); }
});

test("joining authenticates each immutable revision once and picks up a commit published before the first sync", async () => {
    const prior = {window:global.window, document:global.document};
    global.window = {setInterval:()=>0}; global.document = {};
    try {
        const srv = server(), source = new Map(), files = new Map();
        for (let i=0; i<10; i++) source.set(i+".md",bytes("note "+i));
        const mac = await device(srv,source), ipad = await device(srv,files);
        await mac.startSetup({address:"https://dav.example",folder:"progress",username:"tester"},srv.password);
        const invite=mac.sharingFields(), reads=[], steps=[];
        let active=0, peak=0;
        srv.onRead=async name=>{
            if (!name.startsWith("objects/r-")) return;
            reads.push(name); peak=Math.max(peak,++active);
            await new Promise(setImmediate);
            active--;
        };
        ipad.settingsTab.refreshProgress=()=>steps.push(ipad.progress);
        await ipad.join(invite,invite.key,invite.id);
        assert.equal(peak,8);
        assert.equal(reads.length,10);
        assert.deepEqual(steps[0],{phase:"connecting",done:0,total:null});
        assert.deepEqual(steps.filter(s=>s?.phase==="versions").map(s=>s.done),Array.from({length:11},(_,i)=>i));
        const {store}=await mac.connect(mac.state.current,srv.password,invite.key);
        await store.publish("later.md",[],bytes("arrived while joining"));
        assert.equal((await ipad.run()).received,11);
        assert.equal(reads.length,11);
        assert.equal(new Set(reads).size,11);
        assert.deepEqual(steps.filter(s=>s?.phase==="files").map(s=>s.done),Array.from({length:12},(_,i)=>i));
        assert.equal(steps.at(-1),null);
        assert.deepEqual(files.get("later.md"),bytes("arrived while joining"));
        for (const [path,data] of source) assert.deepEqual(files.get(path),data);
    } finally { Object.assign(global,prior); }
});

test("a failed metadata batch finishes its outstanding reads and leaves the joining device unbound for retry", async () => {
    const prior={window:global.window,document:global.document};
    global.window={setInterval:()=>0}; global.document={};
    try {
        const srv=server(), source=new Map();
        for (let i=0;i<9;i++) source.set(i+".md",bytes("note"));
        const mac=await device(srv,source), peer=await device(srv);
        await mac.startSetup({address:"https://dav.example",folder:"retry",username:"tester"},srv.password);
        const invite=mac.sharingFields();
        let requests=0, inflight=0;
        srv.onRead=async name=>{
            if (!name.startsWith("objects/r-")) return;
            if (++requests===1) throw Error("connection interrupted");
            inflight++; await new Promise(setImmediate); inflight--;
        };
        await assert.rejects(peer.join(invite,invite.key,invite.id),/interrupted/);
        assert.equal(requests,8); assert.equal(inflight,0);
        assert.equal(peer.state.current,undefined); assert.equal(peer.cache.size,0);
        assert.equal(peer.progress,null);
        delete srv.onRead;
        await peer.join(invite,invite.key,invite.id);
        assert.equal((await peer.run()).received,9);
    } finally { Object.assign(global,prior); }
});

function measureReads(srv, firstBatch = {}) {
    const stats = {r:{calls:0,peak:0}, b:{calls:0,peak:0}};
    const gates = Object.fromEntries(Object.entries(firstBatch).map(([kind,count])=>{
        let release;
        const wait = new Promise(resolve=>{release=resolve;});
        return [kind,{count,wait,release}];
    }));
    let active = 0;
    srv.onRead = async name => {
        const match = /^objects\/([rb])-/.exec(name);
        if (!match) return;
        const stat = stats[match[1]];
        stat.calls++;
        stat.peak = Math.max(stat.peak, ++active);
        const gate = gates[match[1]];
        if (gate) {
            if (stat.calls === gate.count) gate.release();
            await gate.wait;
        }
        await new Promise(setImmediate);
        active--;
    };
    return stats;
}

async function cacheFixture(t, count) {
    const prior = {window:global.window, document:global.document};
    global.window = {setInterval:()=>0}; global.document = {};
    t.after(()=>Object.assign(global,prior));
    const srv = server(), disk = new Map(), secrets = new Map(), files = new Map(), source = new Map();
    for (let i=0; i<count; i++) source.set("private-"+i+".md",bytes("note "+i));
    const mac = await device(srv,source);
    await mac.startSetup({address:"https://dav.example",folder:"cache",username:"tester"},srv.password);
    const invite = mac.sharingFields(), restart = () => device(srv,files,disk,secrets);
    const peer = await restart();
    const joinStats = measureReads(srv,{r:Math.min(count,8)});
    await peer.join(invite,invite.key,invite.id);
    const pointer = () => disk.get("homebound-revision-cache-v1-"+invite.id);
    const snapshot = () => peer.revisions.path(invite.id,pointer().generation);
    return {srv, disk, files, source, mac, invite, restart, peer, joinStats, pointer, snapshot};
}

test("first download after restart uses eight reads, daily refresh uses four and fetches only new revisions", async t => {
    const {srv, disk, files, source, mac, restart, joinStats, snapshot} = await cacheFixture(t,18);
    assert.deepEqual(joinStats.r,{calls:18,peak:8});
    assert.equal(joinStats.b.calls,0);
    assert.match(snapshot(),/^\.obsidian\/plugins\/homebound-webdav\/versions-/);
    assert(!Buffer.from(disk.get(snapshot())).includes("private-"));
    let peer = await restart(), stats = measureReads(srv,{b:8});
    assert.equal((await peer.run()).received,18);
    assert.deepEqual(stats.r,{calls:0,peak:0});
    assert.deepEqual(stats.b,{calls:18,peak:8});
    assert.deepEqual(files,source);

    for (const path of source.keys()) source.set(path,bytes("new "+path));
    assert.equal((await mac.run()).sent,18);
    peer = await restart(); stats = measureReads(srv,{r:4,b:4});
    assert.equal((await peer.run()).received,18);
    assert.deepEqual(stats.r,{calls:18,peak:4});
    assert.deepEqual(stats.b,{calls:18,peak:4});
    assert.deepEqual(files,source);
    for (let i=0; i<3; i++) source.set("extra-"+i+".md",bytes("extra"));
    assert.equal((await mac.run()).sent,3);
    peer = await restart(); stats = measureReads(srv);
    assert.equal((await peer.run()).received,3);
    assert.equal(stats.r.calls,3);
    assert.deepEqual(files,source);
    const path = snapshot();
    peer = await restart(); stats = measureReads(srv);
    assert.equal((await peer.run()).received,0);
    assert.equal(stats.r.calls+stats.b.calls,0);
    assert.equal(snapshot(),path);
});

test("cache rebuild is read-only remotely, preserves the old generation on network or disk failure, and counts missing commits", async t => {
    const {srv,disk,peer,invite,files,restart,pointer,snapshot} = await cacheFixture(t,12);
    await peer.run();
    const originalNotes = structuredClone(files), old = snapshot(), packet = disk.get(old), writes = srv.writes;
    srv.onRead = async name => { if (name.startsWith("objects/r-")) throw Error("offline"); };
    await assert.rejects(peer.rebuildRevisionCache(invite.id),/offline/);
    assert.equal(snapshot(),old); assert.deepEqual(disk.get(old),packet);
    const adapter = peer.app.vault.adapter, write = adapter.writeBinary;
    delete srv.onRead;
    adapter.writeBinary = async (path,data) => { await write(path,data.slice(0,3)); throw Error("disk full"); };
    await assert.rejects(peer.rebuildRevisionCache(invite.id),/disk full/);
    assert.equal(snapshot(),old);
    assert.deepEqual([...disk.keys()].filter(path=>path.endsWith(".bin")),[old]);
    adapter.writeBinary = (path,data) => write(path,data.slice(0,3));
    await assert.rejects(peer.rebuildRevisionCache(invite.id),/写入校验失败/);
    assert.equal(snapshot(),old);
    adapter.writeBinary = write;
    let stats = measureReads(srv,{r:4});
    assert.equal(await peer.rebuildRevisionCache(invite.id),12);
    assert.deepEqual(stats.r,{calls:12,peak:4}); assert.equal(stats.b.calls,0);
    const fresh = snapshot();
    assert.notEqual(fresh,old); assert(!disk.has(old));
    assert.deepEqual(files,originalNotes); assert.equal(srv.writes,writes);

    // Losing the cache ciphertext must not make a missing remote history look legitimate.
    disk.set(fresh,packet.slice(0,7));
    const cold = await restart();
    assert.equal(cold.cache.size,0);
    srv.hidden = new Set(pointer().ids.slice(0,2));
    stats = measureReads(srv);
    assert.equal(await cold.run(),undefined);
    assert.match(cold.syncError,/缺少 2 条/);
    await assert.rejects(cold.rebuildRevisionCache(invite.id),/缺少 2 条/);
    assert.equal(stats.r.calls+stats.b.calls,0);
    assert.equal(snapshot(),fresh); assert.deepEqual(files,originalNotes); assert.equal(srv.writes,writes);
    srv.hidden.clear();
    assert.equal((await cold.run()).received,0);
    assert.equal(stats.r.calls,12); assert.equal(stats.b.calls,0);
    assert.notEqual(snapshot(),fresh);
    assert.equal((await restart()).cache.size,12);
});

test("a throttled first verification carries the slower limit through download and restart", async t => {
    const {srv,invite} = await cacheFixture(t,13);
    const disk = new Map(), secrets = new Map(), files = new Map();
    const peer = await device(srv,files,disk,secrets);
    let rejected, active=0; const completed = new Set();
    srv.onRead = async name=>{
        if (!name.startsWith("objects/r-")) return;
        active++; await new Promise(setImmediate); active--;
        if (!rejected && active>0) { rejected = name; throw Object.assign(Error("busy"),{status:429}); }
        assert(!completed.has(name)); completed.add(name);
    };
    await peer.join(invite,invite.key,invite.id);
    assert(rejected); assert.equal(completed.size,13);
    const cold = await device(srv,files,disk,secrets), stats = measureReads(srv);
    assert.equal((await cold.run()).received,13);
    assert.deepEqual(stats.b,{calls:13,peak:1});
    assert.equal(cold.state.current.initialReadLimit,undefined);
});

test("rebuilding after a peer publishes leaves notes alone and the next normal poll pulls the new revision", async t => {
    const {peer,source,mac,invite,files}=await cacheFixture(t,2);
    await peer.run();
    peer.watch.accepted={tag:"previous",provisional:false};
    source.set("new.md",bytes("changed during diagnostics"));
    await mac.run();
    assert.equal(await peer.rebuildRevisionCache(invite.id),3);
    assert(!files.has("new.md"));
    peer.ready=true;
    document.visibilityState="visible";
    peer.watch.read=async()=>({tag:"new",provisional:false});
    await peer.pollRemote();
    assert.deepEqual(files,source);
});
