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
    const dav = {password:"fixture-one",failRead:false,requests:0};
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
                .map(k => k.slice(prefix.length)).filter(k => !k.includes("/"));
        }
        async read(name) {
            this.auth();
            if (dav.onRead) await dav.onRead(name);
            if (dav.failRead && name.startsWith("objects/b-")) throw Error("readback interrupted");
            const value = files.get(this.child(name).root);
            if (!value) throw Object.assign(Error("absent"),{status:404});
            return value;
        }
        async put(name, content) { this.auth(); files.set(this.child(name).root,content); }
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
    p.app = {appId:"test",vault:{getName:()=>"Vault",adapter:{exists:async()=>false},getAbstractFileByPath:()=>null},workspace:{onLayoutReady(){}},
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
        assert.equal(peak,4);
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
        assert.equal(requests,4); assert.equal(inflight,0);
        assert.equal(peer.state.current,undefined); assert.equal(peer.cache.size,0);
        assert.equal(peer.progress,null);
        delete srv.onRead;
        await peer.join(invite,invite.key,invite.id);
        assert.equal((await peer.run()).received,9);
    } finally { Object.assign(global,prior); }
});
