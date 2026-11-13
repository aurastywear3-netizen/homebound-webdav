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
    const bad={...f.rec,token:f.rec.token};await assert.rejects(f.ledger("policy",{head:pq.latest(s).digest,row:JSON.stringify({policy:{by:"recovery"}})},bad.token),/denied/);
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
        const p=new mockModule.exports();
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
