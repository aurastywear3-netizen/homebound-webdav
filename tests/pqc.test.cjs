"use strict";
const {test,before,after}=require("node:test");
const assert=require("node:assert/strict");
const {spawn}=require("node:child_process");
const fs=require("node:fs/promises"),os=require("node:os"),path=require("node:path");
const {createHash,randomBytes}=require("node:crypto");
const pq=require("../src/pqc.cjs"),core=require("../src/core.cjs");
const {ml_kem768:kem}=require("@noble/post-quantum/ml-kem.js");
const {ml_dsa65:dsa}=require("@noble/post-quantum/ml-dsa.js");
const suite="homebound-pqc-preview-2";
const buffer=s=>new TextEncoder().encode(s), text=b=>new TextDecoder().decode(b);
const b64=b=>Buffer.from(b).toString("base64"), un64=s=>Buffer.from(s,"base64");
const aes=(raw,usage)=>crypto.subtle.importKey("raw",raw,"AES-GCM",false,[usage]);
const seed=()=>pq.identity(pq.freshSeed(),"device"),root=()=>pq.identity(pq.freshSeed(),"recovery");
let dir;
before(async()=>{dir=await fs.mkdtemp(path.join(os.tmpdir(),"pqc-isolated-"));});
after(async()=>{await fs.rm(dir,{recursive:true,force:true});});
class Dav{
    constructor(files=new Map(),prefix=""){this.files=files;this.prefix=prefix;}
    child(n){return new Dav(this.files,this.prefix+n+"/");}
    async put(n,b){this.files.set(this.prefix+n,new Uint8Array(b));}
    async read(n){if(!this.files.has(this.prefix+n))throw Error("DAV missing");return this.files.get(this.prefix+n);}
}
async function service(t){
    const bootstrap=b64(randomBytes(32)), unique=core.randomId(),verifier=path.join(dir,unique+".verifier");
    await fs.writeFile(verifier,createHash("sha256").update(bootstrap).digest("hex"));
    const proc=spawn("python3",["-B","-u",path.join(__dirname,"../witness/server.py"),"--port","0","--db",path.join(dir,unique+".db"),"--bootstrap-verifier",verifier],{stdio:["ignore","pipe","inherit"]});
    t.after(()=>proc.kill());
    const port=await new Promise((ok,fail)=>{proc.stdout.once("data",buf=>ok(Number(buf.toString().trim())));proc.once("error",fail);proc.once("exit",()=>fail(Error("ledger closed")));});
    async function ledger(method,data,token){
        const headers={"Content-Type":"application/json"};
        if(token)headers.Authorization="Bearer "+token;
        const r=await fetch("http://127.0.0.1:"+port+"/"+method,{method:"POST",headers,body:JSON.stringify(data)});
        const val=await r.json();if(!r.ok)throw Object.assign(Error(val.error),{status:r.status});return val;
    }
    return {ledger,bootstrap};
}
async function setup(t){
    const {ledger,bootstrap}=await service(t),dav=new Dav(),owner=await seed(),guest=await seed(),rec=await root();
    await pq.genesis(ledger,owner,"Owner",rec,bootstrap);
    const state=()=>pq.state(ledger,rec.id);
    let s=await state();
    const code=await pq.requestPair(dav,s,guest,"Guest");
    await pq.nextPolicy(ledger,s,owner,"approve",await pq.readRequest(dav,s,code));
    s=await state();
    const revoke=()=>pq.nextPolicy(ledger,s,owner,"revoke",guest.id);
    return {ledger,dav,owner,guest,rec,code,state,s,revoke};
}
async function takeover(f,rec=f.rec,device,renewed){
    device??=await seed();renewed??=await root();
    await pq.nextPolicy(f.ledger,await f.state(),rec,"restore",{id:device.id,pub:pq.publicDevice(device,"Recovered"),recovery:renewed.pub});
    return {device,renewed,s:await f.state()};
}
async function oldKey(s,dev){
    const {p}=pq.latest(s),[ct,iv,box]=p.boxes[dev.id];
    const shared=kem.decapsulate(un64(ct),dev.enc);
    return core.parseBytes(await crypto.subtle.decrypt({name:"AES-GCM",iv:un64(iv),additionalData:core.jsonBytes([suite,"envelope",p.anchor,p.n,dev.id])},await aes(shared,"decrypt"),un64(box))).at(-1);
}
test("01: unsigned marker cannot block revocation or recovery; bad data is independent of control-plane",async t=>{
    const f=await setup(t);await f.dav.child("commits").put("a".repeat(32),buffer("unsigned"));
    await f.revoke();await assert.rejects(pq.storeFor(f.ledger,f.dav,await f.state(),f.guest),/撤销/);
    const {device,s}=await takeover(f);assert.equal((await (await pq.storeFor(f.ledger,f.dav,s,device)).history()).size,0);
});
test("02: commit acknowledged before rotation survives even if administrator had an older snapshot",async t=>{
    const f=await setup(t),writer=await pq.storeFor(f.ledger,f.dav,f.s,f.guest);
    const rev=await writer.publish("accepted.md",[],buffer("yes"));
    await f.revoke();const reader=await pq.storeFor(f.ledger,f.dav,await f.state(),f.owner);
    assert.equal(text(await reader.readBody((await reader.history()).get(rev.id))),"yes");
});
test("03: concurrent revoke wins after ciphertext upload; no wrapped file key is published",async t=>{
    const f=await setup(t),old=await oldKey(f.s,f.guest);
    let attempted;
    const race=async(m,d,token)=>{
        if(m==="commit"){assert.equal(f.dav.files.size,2);await f.revoke();attempted=JSON.parse(d.row).record.id;}
        return f.ledger(m,d,token);
    };
    const writer=await pq.storeFor(race,f.dav,f.s,f.owner);
    await assert.rejects(writer.publish("racing.md",[],buffer("private")),/changed/);
    const s=await f.state();assert.equal(s.rows.length,0);
    const orphan=await f.dav.child("objects").read(attempted);
    await assert.rejects(crypto.subtle.decrypt({name:"AES-GCM",iv:orphan.subarray(0,12),additionalData:core.jsonBytes([suite,f.rec.id,attempted,"body"])},await aes(un64(old),"decrypt"),orphan.subarray(12)));
    const active=await pq.storeFor(f.ledger,f.dav,s,f.owner);await active.publish("racing.md",[],buffer("private"));
    assert.equal((await f.state()).rows.length,1);
});
test("04: recovery rejects reuse of the old administrator and makes new admin independent from clones",async t=>{
    const f=await setup(t);
    await assert.rejects(takeover(f,f.rec,f.owner),/新的设备/);
    const {device,s}=await takeover(f);
    const writer=await pq.storeFor(f.ledger,f.dav,s,device);
    await writer.publish("new.md",[],buffer("secret"));
    await assert.rejects(pq.storeFor(f.ledger,f.dav,await f.state(),f.owner),/撤销/);
    await assert.rejects(pq.nextPolicy(f.ledger,await f.state(),f.owner,"seal-history"),/管理/);
});
test("05: stale pairing code cannot re-admit a revoked device; retries are fresh and requests expire",async t=>{
    const f=await setup(t);await f.revoke();const current=await f.state();
    await assert.rejects(pq.readRequest(f.dav,current,f.code),/过期/);
    const code=await pq.requestPair(f.dav,current,f.guest,"Guest");
    const second=await pq.requestPair(f.dav,current,f.guest,"Guest");assert.notEqual(code,second);
    const now=Date.now;t.mock.method(Date,"now",()=>now()+11*60000);
    await assert.rejects(pq.readRequest(f.dav,current,second),/过期/);
});
test("06: DAV rollback cannot hide management state or permit stale clean-device recovery",async t=>{
    const f=await setup(t),oldSnapshot=structuredClone(f.s);
    const staleDav=new Dav(new Map(f.dav.files));await f.revoke();
    const actual=await f.state();assert.ok(pq.latest(actual).p.n>pq.latest(oldSnapshot).p.n);
    await assert.rejects(pq.storeFor(f.ledger,staleDav,actual,f.guest),/撤销/);
    const newDev=await seed(),newRoot=await root();
    await assert.rejects(pq.nextPolicy(f.ledger,oldSnapshot,f.rec,"restore",{id:newDev.id,pub:newDev.pub,recovery:newRoot.pub}),/changed/);
    await assert.rejects(pq.state(async()=>({nonce:"replayed",policies:["stale"]}),f.rec.id),/当前状态/);
});
test("07: substituted pairing public key and tampered device signature are both denied",async t=>{
    const f=await setup(t),a=await seed(),b=await seed(),rq=f.dav.child("requests");
    const code=await pq.requestPair(f.dav,f.s,a,"new"),bad=await pq.requestPair(f.dav,f.s,b,"new");
    const original=core.parseBytes(await rq.read(code));
    await rq.put(code,await rq.read(bad));await assert.rejects(pq.readRequest(f.dav,f.s,code),/替换/);
    const sig=un64(original.sig);sig[5]^=1;original.sig=b64(sig);await rq.put(code,core.jsonBytes(original));
    await assert.rejects(pq.readRequest(f.dav,f.s,code),/签名/);
});
test("08: authorized cyclic signed revision cannot silently disappear on restore; emergency rotation still works",async t=>{
    const f=await setup(t),{p,digest}=pq.latest(f.s),id=core.randomId(),old=await oldKey(f.s,f.guest);
    const iv=randomBytes(12),meta={id,path:"cyclic.md",parents:[id],hash:null,key:null};
    const cipher=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:core.jsonBytes([suite,p.anchor,p.n,id,"manifest"])},await aes(un64(old),"encrypt"),core.jsonBytes(meta));
    const record={id,from:f.guest.id,anchor:p.anchor,epoch:p.n,head:digest,payload:b64(Buffer.concat([iv,new Uint8Array(cipher)]))};
    const sig=b64(dsa.sign(core.jsonBytes([suite,"revision",record]),f.guest.sign));
    await f.ledger("commit",{head:digest,row:JSON.stringify({record,sig})},f.guest.token);
    const {s,device}=await takeover(f);
    await assert.rejects(pq.storeFor(f.ledger,f.dav,s,device),err=>err.path==="cyclic.md"&&err.id===id&&/含环/.test(err.message));
    assert.equal(pq.latest(s).p.admin,device.id);
    const a=core.randomId(),b=core.randomId(),base=core.randomId();
    assert.throws(()=>pq.validateGraph([{...meta,id:base,parents:[]},{...meta,id:a,parents:[b,base]},{...meta,id:b,parents:[a,base]}]),/含环/);
});
test("09: missing ciphertext is reported with path and revision ID after emergency recovery",async t=>{
    const f=await setup(t),wr=await pq.storeFor(f.ledger,f.dav,f.s,f.owner);
    const rev=await wr.publish("missing.md",[],buffer("test"));f.dav.files.delete("objects/"+rev.id);
    const {s,device}=await takeover(f);
    const audit=await pq.auditData(await pq.storeFor(f.ledger,f.dav,s,device));
    assert.deepEqual(audit.faults,[{id:rev.id,path:rev.path}]);assert.equal(audit.checked,1);
});
test("10: copied recovery root cannot reclaim or read future writes after recovery rotates the root",async t=>{
    const f=await setup(t),{s,device,renewed}=await takeover(f);
    await (await pq.storeFor(f.ledger,f.dav,s,device)).publish("new.md",[],buffer("new root"));
    await assert.rejects(takeover(f,f.rec),/恢复身份/);
    const bad={...f.rec,token:f.rec.token};await assert.rejects(f.ledger("policy",{head:pq.latest(await f.state()).digest,row:JSON.stringify({policy:{by:"recovery"}})},bad.token),/denied/);
    const again=await takeover(f,renewed);assert.equal((await (await pq.storeFor(f.ledger,f.dav,again.s,again.device)).history()).size,1);
});

test("11: recovery can resume on the same device after an accepted rotation loses its response",async t=>{
    const f=await setup(t);
    const mockModule={exports:{}};
    const obsidian={Plugin:class {},Modal:class {},PluginSettingTab:class {}};
    const bundled=await fs.readFile(require.resolve("../main.js"),"utf8");
    new Function("module","require",bundled)(mockModule,name=>name==="obsidian"?obsidian:require(name));
    const replacement=pq.freshSeed(),originalSeed=pq.freshSeed(),rec=await pq.identity(originalSeed,"recovery");
    // Bootstrap a separate vault so this test also exercises decoding a real offline recovery kit.
    const isolated=await service(t);
    await pq.genesis(isolated.ledger,f.owner,"Original",rec,isolated.bootstrap);
    const secrets=new Map();
    const instance=drop=>{
        const host=new mockModule.exports();
        host.app={loadLocalStorage:()=>null,saveLocalStorage(){}};
        host.mode="legacy";host.selectMode("pqc");
        const p=host.pqc;
        p.config={name:"Replacement",anchor:rec.id};
        p.secret=(key,value)=>{if(value!==undefined)secrets.set(key,value);return secrets.get(key);};
        p.saveData=async()=>{};
        p.ledger=async(method,data,token)=>{
            const result=await isolated.ledger(method,data,token);
            if(drop && method==="policy")throw Error("Reply lost after commit");
            return result;
        };
        p.context=async()=>({s:await p.snapshot(),device:await p.device(),dav:f.dav});
        return p;
    };
    await assert.rejects(instance(true).restore(originalSeed,replacement),/Reply lost/);
    const pendingDevice=secrets.get("pending-device");
    assert.ok(pendingDevice);assert.equal(secrets.get("pending-root"),replacement);
    const restarted=instance(false);
    assert.deepEqual((await restarted.restore(originalSeed,replacement)).faults,[]);
    assert.equal(secrets.get("device"),pendingDevice);assert.equal(secrets.get("pending-root"),"");
    assert.equal((await restarted.snapshot()).policies.length,2);
    await assert.rejects(restarted.restore(originalSeed,pq.freshSeed()),/失效/);
});
test("12: damaged existing attachment is named during recovery",async t=>{
    const f=await setup(t);
    const writer=await pq.storeFor(f.ledger,f.dav,f.s,f.guest);
    const rev=await writer.publish("图像.bin",[],new Uint8Array([0,128,255]));
    const damaged=await f.dav.child("objects").read(rev.id);
    damaged[damaged.length-1]^=1;
    const {device,s}=await takeover(f);
    const report=await pq.auditData(await pq.storeFor(f.ledger,f.dav,s,device));
    assert.deepEqual(report,{checked:1,faults:[{id:rev.id,path:"图像.bin"}]});
});

// Emit a pre-rotation administrator revision against the historical wire format.
async function legacyAdminWrite(ledger,dav,s,owner,path,body){
    const {p,digest}=pq.latest(s),id=core.randomId(),key=randomBytes(32);
    const encrypt=async(raw,label,data)=>{
        const iv=randomBytes(12);
        const ciphertext=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:core.jsonBytes(label)},await aes(raw,"encrypt"),data);
        return Buffer.concat([iv,new Uint8Array(ciphertext)]);
    };
    const rev={id,path,parents:[],hash:await core.sha(body),key:b64(key)};
    await dav.child("objects").put(id,await encrypt(key,[suite,p.anchor,id,"body"],body));
    const payload=await encrypt(un64(await oldKey(s,owner)),[suite,p.anchor,p.n,id,"manifest"],core.jsonBytes(rev));
    const record={anchor:p.anchor,head:digest,epoch:p.n,id,from:owner.id,payload:b64(payload)};
    const sig=b64(dsa.sign(core.jsonBytes([suite,"revision",record]),owner.sign));
    await ledger("commit",{head:digest,row:JSON.stringify({record,sig})},owner.token);
    return rev;
}
// Recreate the beta.2 wire format, including a separate full historical keyring in each recipient envelope.
async function legacySeal(f,s,keys){
    const {p,digest}=pq.latest(s);
    const epoch={suite,n:p.n+1,parent:digest,anchor:p.anchor,by:f.owner.id,recovery:p.recovery,admin:p.admin,members:p.members,boxes:{}};
    const box=async(pub,id)=>{
        const {sharedSecret,cipherText}=kem.encapsulate(un64(pub.kem)),iv=randomBytes(12);
        const context=core.jsonBytes([suite,"envelope",p.anchor,epoch.n,id]);
        const body=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:context},await aes(sharedSecret,"encrypt"),core.jsonBytes(keys));
        return [b64(cipherText),b64(iv),b64(body)];
    };
    for(const [id,pub] of Object.entries(epoch.members))epoch.boxes[id]=await box(pub,id);
    epoch.recoveryBox=await box(epoch.recovery,"recovery");
    const sig=b64(dsa.sign(core.jsonBytes([suite,"policy",epoch]),f.owner.sign));
    const result=await f.ledger("policy",{head:digest,row:JSON.stringify({policy:epoch,sig})},f.owner.token);
    return {p:epoch,digest:result.digest};
}
test("13: a genuine 256-record legacy vault can revoke, recover repeatedly and decrypt pre-upgrade history",async t=>{
    const {ledger,bootstrap}=await service(t),dav=new Dav(),owner=await seed(),guest=await seed(),rec=await root();
    await pq.genesis(ledger,owner,"Owner",rec,bootstrap);
    let s=await pq.state(ledger,rec.id);
    const first=await legacyAdminWrite(ledger,dav,s,owner,"旧代.md",buffer("before capacity"));
    const keys=[await oldKey(s,owner)],f={ledger,owner};
    // A beta.2 owner can sign a membership change. Keep the guest enrolled up to the real boundary.
    for(let n=1;n<=255;n++){
        keys.push(pq.freshSeed());
        const prev=pq.latest(s);
        const input={policies:[{...prev,p:{...prev.p,members:{...prev.p.members,[guest.id]:pq.publicDevice(guest,"Guest")}}}]};
        s={policies:[await legacySeal(f,input,keys)]};
    }
    const full=await pq.state(ledger,rec.id);
    assert.equal(full.policies.length,256);
    const writer=await pq.storeFor(ledger,dav,full,guest);
    const lastWrite=await writer.publish("满额.md",[],buffer("last legacy"));
    await assert.rejects(legacySeal(f,full,[...keys,pq.freshSeed()]),/Upgrade/);
    await pq.nextPolicy(ledger,full,owner,"revoke",guest.id);
    await assert.rejects(writer.publish("被撤销.md",[],buffer("stale")),/changed/);
    const latestState=()=>pq.state(ledger,rec.id),rotated=await latestState();
    assert.equal(pq.latest(rotated).p.n,256);
    await assert.rejects(pq.storeFor(ledger,dav,rotated,guest),/撤销/);
    const read=await pq.storeFor(ledger,dav,rotated,owner);
    assert.equal(text(await read.readBody((await read.history()).get(first.id))),"before capacity");
    const after=await read.publish("换钥后.md",[],buffer("after revoke"));
    const recovered=await takeover({ledger,state:latestState,rec});
    const again=await takeover({ledger,state:latestState,rec:recovered.renewed});
    assert.equal(pq.latest(again.s).p.n,259); // revocation, admin write, and two takeovers
    assert.equal(pq.latest(again.s).p.legacyKeys,undefined);
    const restored=await pq.storeFor(ledger,dav,again.s,again.device);
    const history=await restored.history();
    assert.equal(text(await restored.readBody(history.get(lastWrite.id))),"last legacy");
    assert.equal(text(await restored.readBody(history.get(after.id))),"after revoke");
    assert.deepEqual((await pq.auditData(restored)).faults,[]);
    await assert.rejects(pq.storeFor(ledger,dav,again.s,recovered.device),/撤销/);
    await assert.rejects(takeover({ledger,state:latestState,rec}),/恢复身份/);
});
test("14: full 32-member roster still permits revocation and recovery, compact rows stay bounded",async t=>{
    const f=await setup(t);
    let current=f.s;
    const guests=[];
    for(let i=2;i<=32;i++){
        const device=await seed(),code=await pq.requestPair(f.dav,current,device,"Guest "+i);
        const request=await pq.readRequest(f.dav,current,code);
        const add=()=>pq.nextPolicy(f.ledger,current,f.owner,"approve",request);
        if(i===32){await assert.rejects(add(),/membership/);break;}
        const committed=await add();guests.push(device);current.policies.push(committed);
    }
    assert.equal(Object.keys(pq.latest(current).p.members).length,32);
    const head=pq.latest(current);
    assert.ok(Buffer.byteLength(JSON.stringify(head.p))<300*1024);
    const memberLimitWriter=await pq.storeFor(f.ledger,f.dav,current,f.owner);
    const rev=await memberLimitWriter.publish("all-members.md",[],buffer("32 members"));
    current=await f.state();
    assert.equal(pq.latest(current).p.revisionId,rev.id);
    assert.equal(Object.keys(pq.latest(current).p.boxes).length,32);
    await pq.nextPolicy(f.ledger,current,f.owner,"revoke",guests.at(-1).id);
    const {device,s}=await takeover({...f,state:f.state});
    assert.equal(Object.keys(pq.latest(s).p.members).length,1);
    assert.deepEqual((await pq.auditData(await pq.storeFor(f.ledger,f.dav,s,device))).faults,[]);
});

test("15: official-ID candidate preserves legacy settings and opens PQC only after an explicit selection",async()=>{
    const bundle=await fs.readFile(require.resolve("../main.js"),"utf8");
    const mock={exports:{}};
    new Function("module","require",bundle)(mock,()=>({Plugin:class{},PluginSettingTab:class{},Modal:class{},getLanguage:()=>"en"}));
    const values=new Map(), legacy={id:"legacy-id",secretId:"key",auto:true,folder:"notes"};
    const plugin=new mock.exports();plugin.manifest={id:"homebound-webdav"};
    plugin.loadData=async()=>({...legacy});plugin.saveData=async()=>assert.fail("rewrote 0.1.1 settings");
    plugin.app={vault:{getName:()=>"vault"},workspace:{onLayoutReady(){}},loadLocalStorage:k=>values.get(k),
        saveLocalStorage:(k,v)=>values.set(k,v)};
    plugin.addCommand=plugin.addSettingTab=plugin.registerDomEvent=plugin.registerInterval=()=>{};
    const globals={window:global.window,document:global.document};
    global.window={setInterval:()=>0};global.document={};
    try{
        await plugin.onload();
        assert.equal(plugin.mode,"legacy");assert.equal(plugin.config.secretId,"key");
        assert.equal(values.size,0);assert.equal(plugin.pqc,undefined);
        plugin.busy=true;assert.throws(()=>plugin.selectMode("pqc"),/Finish/);plugin.busy=false;
        plugin.selectMode("pqc");
        const identity=plugin.pqc.config.local;
        assert.ok(identity);assert.equal(plugin.pqc.config.request,undefined);assert.equal(plugin.pqc.config.anchor,undefined);
        const previous=plugin.pqc;plugin.selectMode("legacy");
        await assert.rejects(previous.exclusive(async()=>{}),/关闭/);
        plugin.selectMode("pqc");assert.equal(plugin.pqc.config.local,identity);
        assert.equal(plugin.config.id,legacy.id);assert.equal(plugin.config.auto,true);
    }finally{Object.assign(global,globals);}
});

test("chunked transfer crossing revocation leaves ciphertext only; a new epoch cannot reuse staged keys",async t=>{
    const {ChunkTransfer,threshold}=require("../src/transfer.cjs");
    const f=await setup(t),cache=new Map(),stored=new Map(),path="附件.bin";
    const transfer=new ChunkTransfer({
        get:k=>cache.get(JSON.stringify(k)),put:(k,v)=>cache.set(JSON.stringify(k),structuredClone(v)),
        remove:k=>cache.delete(JSON.stringify(k)),clearDownload:()=>cache.clear()
    },{enabled:true,wait:async()=>{}});
    const data=new Uint8Array(threshold+3);data[100]=98;
    const old=await pq.storeFor(f.ledger,f.dav,f.s,f.guest,transfer);
    let uploads=0;
    const remote=f.dav.child("objects"),child=f.dav.child.bind(f.dav);
    f.dav.child=n=>n==="objects"?remote:child(n);
    const put=remote.put.bind(remote);
    remote.put=async(n,b)=>{await put(n,b);stored.set(n,b);if(++uploads===2)await f.revoke();};
    const writer=await pq.storeFor(f.ledger,f.dav,f.s,f.guest,transfer);
    await assert.rejects(writer.publish(path,[],data),e=>e.status===409 || e.status===403);
    const current=await f.state();assert.equal(current.rows.length,0);
    await assert.rejects(pq.storeFor(f.ledger,f.dav,current,f.guest,transfer),/撤销/);
    const orphanNames=[...stored.keys()];assert.equal(orphanNames.length,9);
    remote.put=put;
    const owner=await pq.storeFor(f.ledger,f.dav,current,f.owner,transfer);
    const rev=await owner.publish(path,[],data);
    for(const id of orphanNames)f.dav.files.delete("objects/"+id);
    const reader=await pq.storeFor(f.ledger,f.dav,await f.state(),f.owner,transfer);
    const history=await reader.history();assert.equal(history.size,1);
    assert.deepEqual(new Uint8Array(await reader.readBody(history.get(rev.id))),data);
    const raw=(await f.state()).rows[0];assert.ok(!raw.includes(path) && !raw.includes(rev.parts.seed));
    assert.equal((await old.history()).size,0);
});

test("admin edits and deletion each open a fresh epoch, with fresh envelopes for every recipient",async t=>{
    const f=await setup(t),pins=[];
    const store=await pq.storeFor(f.ledger,f.dav,f.s,f.owner,undefined,(n,digest)=>pins.push({n,digest}));
    const one=await store.publish("note.md",[],buffer("one"));
    const two=await store.publish("note.md",[one.id],buffer("two"));
    const three=await store.publish("note.md",[two.id],null);
    let s=await f.state();
    assert.deepEqual(s.policies.slice(-3).map(({p})=>p.revisionId),[one.id,two.id,three.id]);
    assert.deepEqual(s.rows.map(row=>JSON.parse(row).record.epoch),pins.map(({n})=>n));
    assert.deepEqual(pins.map(pin=>pin.digest),s.policies.slice(-3).map(entry=>entry.digest));
    const prior=await oldKey(f.s,f.owner),epochs=new Set([prior]);
    const seen=new Map();
    for(const entry of s.policies.slice(-4)){
        const p=entry.p;
        for(const [label,actor,box] of [["admin",f.owner,p.boxes[f.owner.id]],["member",f.guest,p.boxes[f.guest.id]],["recovery",f.rec,p.recoveryBox]]){
            const [ct,iv,cipher]=box;
            const secret=kem.decapsulate(un64(ct),actor.enc);
            const group=seen.get(label)||[new Set(),new Set(),new Set(),new Set()];
            [ct,b64(secret),cipher,iv].forEach((value,i)=>{assert.ok(!group[i].has(value));group[i].add(value);});
            seen.set(label,group);
            const recovered=core.parseBytes(await crypto.subtle.decrypt({
                name:"AES-GCM",iv:un64(iv),additionalData:core.jsonBytes([suite,"envelope",p.anchor,p.n,label==="recovery"?"recovery":actor.id])
            },await aes(secret,"decrypt"),un64(cipher))).at(-1);
            assert.equal(recovered,await oldKey({policies:[entry]},f.owner));
        }
        if(p.revisionId){
            const key=await oldKey({policies:[entry]},f.owner);assert.ok(!epochs.has(key));epochs.add(key);
            const {record}=JSON.parse(s.rows.find(row=>JSON.parse(row).record.id===p.revisionId)),packet=un64(record.payload);
            await assert.rejects(crypto.subtle.decrypt({name:"AES-GCM",iv:packet.subarray(0,12),additionalData:core.jsonBytes([suite,p.anchor,p.n,record.id,"manifest"])},await aes(un64(prior),"decrypt"),packet.subarray(12)));
        }
    }
    const guest=await pq.storeFor(f.ledger,f.dav,s,f.guest);
    assert.equal(text(await guest.readBody((await guest.history()).get(two.id))),"two");
    await guest.publish("member.md",[],buffer("member"));
    const after=await f.state();assert.equal(after.policies.length,s.policies.length);
    const takeoverState=await takeover(f);
    const recovered=await pq.storeFor(f.ledger,f.dav,takeoverState.s,takeoverState.device);
    assert.deepEqual(await pq.auditData(recovered),{checked:4,faults:[]});
});

test("half-commits roll back, exact lost acknowledgements are idempotent and publication cannot downgrade",async t=>{
    const f=await setup(t);let captured;
    const intercept=async(method,data,token)=>{
        if(!data.rotation)return f.ledger(method,data,token);
        captured=data;
        const malformed=JSON.parse(data.row);malformed.record.head=data.head;
        await assert.rejects(f.ledger(method,{...data,row:JSON.stringify(malformed)},token),e=>e.status===409);
        const before=await f.state();assert.equal(before.policies.length,f.s.policies.length);assert.equal(before.rows.length,0);
        await assert.rejects(f.ledger("policy",{head:data.head,row:data.rotation},token),e=>e.status===400);
        await assert.rejects(f.ledger(method,data,f.guest.token),e=>e.status===403);
        const reused=JSON.parse(data.rotation);
        reused.policy.recoveryBox=pq.latest(f.s).p.recoveryBox;
        await assert.rejects(f.ledger(method,{...data,rotation:JSON.stringify(reused)},token),/Reused recipient/);
        // Deliver the transaction, then drop the reply.
        await f.ledger(method,data,token);throw Error("reply lost");
    };
    const bytes=buffer("saved"),writer=await pq.storeFor(intercept,f.dav,f.s,f.owner);
    const baseline=new Map(),local={paths:()=>new Set(["note.md"]),allowed:()=>true,read:()=>bytes};
    const sync=store=>core.synchronize({store,local,baseline,cache:new Map(),checkpoint(){}});
    await assert.rejects(sync(writer),/reply lost/);
    const receipt=await f.ledger("commit",captured,f.owner.token),s=await f.state();
    assert.equal(s.rows.length,1);assert.equal(receipt.policyDigest,pq.latest(s).digest);
    const fresh=await pq.storeFor(f.ledger,f.dav,s,f.owner);
    const result=await sync(fresh);assert.equal(result.sent,0);assert.equal(result.received,0);
    assert.deepEqual((await f.state()).policies,s.policies);
    await assert.rejects(legacyAdminWrite(f.ledger,f.dav,s,f.owner,"old.md",buffer("x")),e=>e.status===426);
    await assert.rejects(pq.storeFor(f.ledger,f.dav,{...s,rows:[]},f.guest),/修订缺失/);
    const newHead=await pq.nextPolicy(f.ledger,s,f.owner,"seal-history");
    await assert.rejects(legacyAdminWrite(f.ledger,f.dav,await f.state(),f.owner,"old.md",buffer("x")),e=>e.status===426);
    assert.equal(pq.latest(await f.state()).digest,newHead.digest);
});

test("pairing survives note edits, expires at membership changes, and concurrent recovery fences the old admin",async t=>{
    const f=await setup(t),joining=await seed(),code=await pq.requestPair(f.dav,f.s,joining,"joining");
    const writer=await pq.storeFor(f.ledger,f.dav,f.s,f.owner);
    await writer.publish("first.md",[],buffer("first"));let s=await f.state();
    const candidate=await pq.readRequest(f.dav,s,code);
    await writer.publish("second.md",[],buffer("second"));s=await f.state();
    await pq.nextPolicy(f.ledger,s,f.owner,"approve",candidate);
    await assert.rejects(pq.readRequest(f.dav,await f.state(),code),/过期/);
    const current=await f.state();
    const race=async(method,data,token)=>{
        if(data.rotation)await takeover(f);
        return f.ledger(method,data,token);
    };
    await assert.rejects((await pq.storeFor(race,f.dav,current,f.owner)).publish("obsolete.md",[],buffer("secret")),e=>[403,409].includes(e.status));
    const result=await f.state();assert.equal(result.rows.length,2);assert.equal(result.policies.length,current.policies.length+1);
    assert.ok(!pq.latest(result).p.members[f.owner.id]);
});

test("unsupported witnesses stop before upload, and same-head competing admin writes have only one winner",async t=>{
    const f=await setup(t),old=await pq.state(async(method,data,token)=>{
        const reply=await f.ledger(method,data,token);delete reply.adminRevisionRotation;return reply;
    },f.rec.id);
    const count=f.dav.files.size;
    await assert.rejects((await pq.storeFor(f.ledger,f.dav,old,f.owner)).publish("a",[],buffer("new")),/升级/);
    assert.equal(f.dav.files.size,count);
    const writer=await pq.storeFor(f.ledger,f.dav,f.s,f.owner);
    const writes=await Promise.allSettled(["a","b"].map(p=>writer.publish(p,[],buffer(p))));
    assert.equal(writes.filter(v=>v.status==="fulfilled").length,1);
    assert.equal(writes.find(v=>v.status==="rejected").reason.status,409);
    const s=await f.state();assert.equal(s.rows.length,1);assert.equal(s.policies.length,f.s.policies.length+1);
});

test("a guest resumes a legacy chunk checkpoint across an admin rotation, then verifies its new revision",async t=>{
    const {ChunkTransfer,threshold}=require("../src/transfer.cjs");
    const f=await setup(t),slots=new Map();
    const cache={get:k=>structuredClone(slots.get(JSON.stringify(k))),put:(k,v)=>slots.set(JSON.stringify(k),structuredClone(v)),
        remove:k=>slots.delete(JSON.stringify(k)),clearDownload(){}};
    const transfer=new ChunkTransfer(cache,{enabled:true,wait:async()=>{}});
    const body=new Uint8Array(threshold+1),file="partial.bin",scope="pqc/"+f.rec.id;
    const child=f.dav.child.bind(f.dav),objects=child("objects"),put=objects.put.bind(objects);
    let offline=false,cut=true,writes=0;
    objects.put=async(n,b)=>{
        if(offline)throw Object.assign(Error("offline"),{offline:true});
        await put(n,b);
        if(++writes===3 && cut){offline=true;throw Object.assign(Error("offline"),{offline:true});}
    };
    const read=objects.read.bind(objects);
    objects.read=n=>{if(offline)throw Object.assign(Error("offline"),{offline:true});return read(n);};
    f.dav.child=n=>n==="objects"?objects:child(n);
    const head=pq.latest(f.s),key=await crypto.subtle.importKey("raw",un64(await oldKey(f.s,f.guest)),"AES-GCM",false,["encrypt","decrypt"]);
    await assert.rejects(transfer.upload({objects,scope,epoch:head.digest,wrapKey:key,path:file,parents:[],hash:await core.sha(body),bytes:body}));
    assert.equal(writes,3);assert.ok(await cache.get([scope,"put",file]));
    const owner=await pq.storeFor(f.ledger,f.dav,f.s,f.owner);
    await owner.publish("removed",[],null);
    assert.equal((await f.state()).policies.length,f.s.policies.length+1);
    // The local checkpoint is upgraded even if the retry also loses connectivity.
    const guest=await pq.storeFor(f.ledger,f.dav,await f.state(),f.guest,transfer);
    await assert.rejects(guest.publish(file,[],body));
    const migrated=await cache.get([scope,"put-device",file]);
    assert.ok(migrated.deviceWrapped);assert.equal(await cache.get([scope,"put",file]),undefined);
    await assert.rejects(core.unseal(key,migrated.binding,migrated.wrapped));
    assert.equal((await core.unseal(f.guest.stagingKey,migrated.binding,migrated.wrapped)).byteLength,32);
    offline=false;cut=false;
    const rev=await guest.publish(file,[],body);assert.equal(writes,9);
    const s=await f.state();
    assert.equal(s.policies.length,f.s.policies.length+1);assert.equal(s.rows.length,2);
    const admin=await pq.storeFor(f.ledger,f.dav,s,f.owner,transfer);
    assert.deepEqual(new Uint8Array(await admin.readBody((await admin.history()).get(rev.id))),body);
});
