const test=require("node:test");
const assert=require("node:assert/strict");
const pq=require("../src/pqc.cjs");
const core=require("../src/core.cjs");
class Dav {
    constructor(files=new Map(),prefix=""){this.files=files;this.prefix=prefix;}
    child(name){return new Dav(this.files,this.prefix+name+"/");}
    get root(){return this.prefix.slice(0,-1);}
    async read(name){
        const value=this.files.get(this.prefix+name);
        if(!value)throw Object.assign(Error("missing"),{status:404});return value;
    }
    async put(name,value){this.files.set(this.prefix+name,value);}
    async mkdir(name){this.files.set(this.prefix+name+"/",true);}
    async list(name){
        const prefix=this.prefix+name+"/";
        return [...this.files.keys()].filter(x=>x.startsWith(prefix)&&x!==prefix).map(x=>x.slice(prefix.length).replace(/\/$/,"")).filter(x=>!x.includes("/"));
    }
    async call(method,from,status,{headers}){
        assert.equal(method,"MOVE");assert.equal(headers.Overwrite,"F");
        const root=this.prefix+from+"/",target=headers.Destination+"/";
        if(this.files.has(target))throw Error("exists");
        for(const [path,data] of [...this.files]){
            if(path.startsWith(root)){this.files.set(target+path.slice(root.length),data);this.files.delete(path);}
        }
    }
}
test("revoked keys cannot open new epoch; late old commits are excluded; signed policy is anchored",async()=>{
    const dav=new Dav(),owner=await pq.identity(pq.freshSeed(),"device"),guest=await pq.identity(pq.freshSeed(),"device"),recovery=await pq.identity(pq.freshSeed(),"recovery");
    await pq.genesis(dav,owner,"owner",recovery);
    let chain=await pq.chain(dav,recovery.id);
    const code=await pq.requestPair(dav,recovery.id,guest,"guest");
    const target=await pq.readRequest(dav,recovery.id,code);
    await pq.nextPolicy(dav,chain,owner,"approve",target);
    chain=await pq.chain(dav,recovery.id);
    const former=await pq.storeFor(dav,chain,guest);
    const published=await former.publish("before.md",[],core.jsonBytes("before"));
    await pq.nextPolicy(dav,chain,owner,"revoke",guest.id);
    const next=await pq.chain(dav,recovery.id);
    await assert.rejects(pq.storeFor(dav,next,guest),/撤销/);
    await assert.rejects(former.publish("late.md",[],core.jsonBytes("late")),/授权已变化/);
    await dav.child("e-00000001").mkdir("commits/"+"f".repeat(32));
    const active=await pq.storeFor(dav,next,owner),visible=await active.history();
    assert.deepEqual([...visible.keys()],[published.id]);
    // A revoked author can still produce a valid old signature for the same revision ID.
    // The admin's signed digest must reject a changed path, even with valid old AEAD and signature.
    const {ml_kem768}=require("@noble/post-quantum/ml-kem.js");
    const {ml_dsa65}=require("@noble/post-quantum/ml-dsa.js");
    const raw=s=>Uint8Array.from(atob(s),ch=>ch.charCodeAt(0)), enc=b=>Buffer.from(b).toString("base64");
    const algorithm=(iv,aad)=>({name:"AES-GCM",iv,additionalData:aad});
    const aes=(key,usage)=>crypto.subtle.importKey("raw",key,"AES-GCM",false,[usage]);
    const policy=chain.at(-1).p, [ct,nonce,box]=policy.boxes[guest.id];
    const shared=ml_kem768.decapsulate(raw(ct),guest.enc);
    const ring=core.parseBytes(await crypto.subtle.decrypt(algorithm(raw(nonce),core.jsonBytes([policy.suite,"envelope",policy.anchor,policy.n,guest.id])),await aes(shared,"decrypt"),raw(box)));
    const epoch=policy.anchor+"/"+policy.n, name="r-"+published.id;
    const data=enc(core.jsonBytes({...published,path:"forged.md"}));
    const sig=ml_dsa65.sign(core.jsonBytes([policy.suite,"revision",epoch,name,guest.id,data]),guest.sign);
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const cipher=await crypto.subtle.encrypt(algorithm(iv,new TextEncoder().encode(epoch+"/"+name)),await aes(raw(ring[1]),"encrypt"),core.jsonBytes({from:guest.id,data,sig:enc(sig)}));
    await dav.child("e-00000001").put("objects/"+name,Buffer.concat([iv,new Uint8Array(cipher)]));
    await assert.rejects(active.history(),/封存/);
    const last=dav.child("e-00000002"),row=core.parseBytes(await last.read("policy.json"));
    row.policy.admin=guest.id;await last.put("policy.json",core.jsonBytes(row));
    await assert.rejects(pq.chain(dav,recovery.id),/签名/);
    await assert.rejects(pq.chain(dav,"1".repeat(32)),/身份/);
});
