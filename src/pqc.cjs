"use strict";
const { ml_kem768: kem } = require("@noble/post-quantum/ml-kem.js");
const { ml_dsa65: dsa } = require("@noble/post-quantum/ml-dsa.js");
const core = require("./core.cjs");
const { jsonBytes, parseBytes, randomId, sha } = core;
const suite = "homebound-pqc-preview-1";
const random = n => crypto.getRandomValues(new Uint8Array(n));
const idPattern = /^[a-f0-9]{32}$/;
function b64(bytes) {
    const a = new Uint8Array(bytes);
    let s = "";
    for (let i=0;i<a.length;i+=8192) s += String.fromCharCode(...a.subarray(i,i+8192));
    return btoa(s);
}
function un64(s) { return Uint8Array.from(atob(s), c=>c.charCodeAt(0)); }
function check(ok, msg) { if (!ok) throw Error(msg); }
function message(domain, fields) { return jsonBytes([suite, domain, ...fields]); }
function signed(domain, fields, key) { return b64(dsa.sign(message(domain,fields),key)); }
function verify(domain, fields, signature, publicKey) {
    check(dsa.verify(un64(signature),message(domain,fields),un64(publicKey)), "签名验证失败。");
}
async function fingerprint(fields) { return (await sha(message("fingerprint",fields))).slice(0,32); }
async function identity(seed, label) {
    // Independent domain-separated deterministic seeds. The root recovery seed is never uploaded.
    const master=await crypto.subtle.importKey("raw",un64(seed),"HKDF",false,["deriveBits"]);
    const derive=async (purpose,size)=>new Uint8Array(await crypto.subtle.deriveBits({
        name:"HKDF",hash:"SHA-256",salt:jsonBytes(suite), info:jsonBytes([label,purpose])
    },master,size*8));
    const enc=kem.keygen(await derive("kem",64)), sig=dsa.keygen(await derive("signature",32));
    const pub={kem:b64(enc.publicKey),sig:b64(sig.publicKey)};
    return {pub,id:await fingerprint([pub.kem,pub.sig]),enc:enc.secretKey,sign:sig.secretKey};
}
const freshSeed=()=>b64(random(32));
const aes=raw=>crypto.subtle.importKey("raw",raw,"AES-GCM",false,["encrypt","decrypt"]);
async function envelope(pub,ring,context) {
    const {sharedSecret,cipherText}=kem.encapsulate(un64(pub.kem));
    const iv=random(12);
    const body=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:message("envelope",context)},await aes(sharedSecret),jsonBytes(ring));
    return [b64(cipherText),b64(iv),b64(body)];
}
async function openRing(pair,wrapped,context) {
    check(wrapped,"此设备未获授权，或已被撤销。");
    const secret=kem.decapsulate(un64(wrapped[0]),pair.enc);
    return parseBytes(await crypto.subtle.decrypt({name:"AES-GCM",iv:un64(wrapped[1]),additionalData:message("envelope",context)},await aes(secret),un64(wrapped[2])));
}
const epochName=n=>"e-"+String(n).padStart(8,"0");
async function readPolicy(dav,n) { return parseBytes(await dav.child(epochName(n)).read("policy.json")); }
async function chain(dav,anchor,checkpoint) {
    check(idPattern.test(anchor),"请核对管理员提供的 32 位库指纹。");
    const policies=[];
    for(let n=0;;n++){
        let row;
        try { row=await readPolicy(dav,n); }
        catch(e){if(n>0 && e.status===404)break; throw e;}
        const p=row.policy;
        check(p.suite===suite && p.n===n && p.anchor===anchor && Number.isSafeInteger(n),"库身份或代数无效。");
        check(await fingerprint([p.recovery.kem,p.recovery.sig])===anchor,"恢复身份不匹配。");
        const prev=policies.at(-1);
        check(p.parent===(prev?.digest||""),"设备授权记录已分叉。");
        const signer=p.by==="recovery"?p.recovery.sig:prev?.p.members[prev.p.admin]?.sig;
        check(signer && (p.by==="recovery" || p.by===prev.p.admin),"无权修改设备列表。");
        verify("policy",[p],row.sig,signer);
        check(p.members[p.admin] && Array.isArray(p.frozen) && p.frozen.every(x=>idPattern.test(x)),"设备列表或封存记录无效。");
        const digest=await sha(jsonBytes(row));
        if(checkpoint?.n===n)check(checkpoint.digest===digest,"服务器回退或替换了设备授权记录。");
        policies.push({p,digest});
    }
    check(!checkpoint || checkpoint.n<policies.length,"服务器返回了旧授权记录。");
    return policies;
}
async function publishPolicy(dav,p,signer,ring) {
    const temp="stage-"+randomId();
    p.boxes={};
    for(const [id,pub] of Object.entries(p.members))
        p.boxes[id]=await envelope(pub,ring,[p.anchor,p.n,id]);
    p.recoveryBox=await envelope(p.recovery,ring,[p.anchor,p.n,"recovery"]);
    const row={policy:p,sig:signed("policy",[p],signer.sign)};
    await dav.mkdir(temp);
    const stage=dav.child(temp);
    await stage.mkdir("objects");await stage.mkdir("commits");
    await stage.put("policy.json",jsonBytes(row).buffer);
    const name=epochName(p.n);
    try { await dav.call("MOVE",temp,[201],{headers:{Destination:dav.child(name).root,Overwrite:"F"}}); }
    catch(e) {
        let found;
        try {found=await readPolicy(dav,p.n);}catch{throw e;}
        check(await sha(jsonBytes(found))===await sha(jsonBytes(row)),"另一台设备已更新授权，请刷新并重试。");
    }
    return row;
}
function publicDevice(device,name) {
    check(typeof name==="string" && name.trim().length>0 && name.length<=64,"请输入设备名称（1 至 64 字）。");
    return {kem:device.pub.kem,sig:device.pub.sig,name:name.trim()};
}
async function genesis(dav,device,name,recovery) {
    const p={suite,n:0,parent:"",by:"recovery",anchor:recovery.id,recovery:recovery.pub,admin:device.id,
        members:{[device.id]:publicDevice(device,name)},frozen:[]};
    return publishPolicy(dav,p,recovery,[freshSeed()]);
}
async function nextPolicy(dav,policies,device,action,arg) {
    const {p,digest}=policies.at(-1);
    const restoring=action==="restore";
    check(restoring?device.id===p.anchor:device.id===p.admin,"该操作需要管理员或正确的恢复码。");
    const keys=await openRing(device,restoring?p.recoveryBox:p.boxes[device.id],[p.anchor,p.n,restoring?"recovery":device.id]);
    const members={...p.members};
    let admin=p.admin;
    if(action==="approve") {
        check(!members[arg.id],"此设备已配对。"); members[arg.id]=arg.pub;
    }else if(action==="revoke"){
        check(arg!==admin && members[arg],"请选择一个已配对的其他设备。");delete members[arg];
    }else if(restoring){
        for(const id of Object.keys(members))delete members[id];
        admin=arg.id;members[admin]=arg.pub;
    }else if(action!=="seal-history")throw Error("未知操作。");
    // Validate all currently visible commits before sealing the old epoch.
    const epochs=await epochStores(dav,policies,device,keys);
    const {all,locations}=await verifiedHistory(epochs,policies);
    const frozen=[...locations.keys()].filter(id=>locations.get(id)===epochs.at(-1)).sort();
    const next={suite,n:p.n+1,parent:digest,by:restoring?"recovery":device.id,anchor:p.anchor,recovery:p.recovery,admin,members,frozen,
        historyDigest:await historyDigest(all)};
    return publishPolicy(dav,next,device,[...keys,freshSeed()]);
}
async function requestPair(dav,anchor,device,name){
    const pub=publicDevice(device,name);
    const fields=[anchor,pub.kem,pub.sig,pub.name];
    const code=await fingerprint(fields);
    const req={pub,signature:signed("join",fields,device.sign)};
    await dav.child("requests").put(code,jsonBytes(req).buffer);
    return code;
}
async function readRequest(dav,anchor,code){
    check(idPattern.test(code),"配对码应为 32 位，请从新设备完整复制。");
    const {pub,signature}=parseBytes(await dav.child("requests").read(code));
    const fields=[anchor,pub.kem,pub.sig,pub.name];
    check(await fingerprint(fields)===code,"配对码与新设备不一致。");
    verify("join",fields,signature,pub.sig);
    return {id:await fingerprint([pub.kem,pub.sig]),pub};
}
class EpochStore extends core.Store {
    constructor(dav,p,device,key,frozen=null){
        const epoch=dav.child(epochName(p.n));
        const transport={read:path=>epoch.read(path),put:(path,v)=>epoch.put(path,v),
            mkdir:path=>epoch.mkdir(path),list:path=>frozen===null?epoch.list(path):Promise.resolve(frozen)};
        super(transport,p.anchor+"/"+p.n,key);this.policy=p;this.device=device;
    }
    async writeObject(name,bytes) {
        if(name.startsWith("r-")){
            const fields=[this.id,name,this.device.id,b64(bytes)];
            bytes=jsonBytes({from:this.device.id,data:fields[3],sig:signed("revision",fields,this.device.sign)});
        }
        return super.writeObject(name,bytes);
    }
    async readObject(name) {
        const bytes=await super.readObject(name);
        if(!name.startsWith("r-"))return bytes;
        const row=parseBytes(bytes),author=this.policy.members[row.from];
        check(author,"未获授权的设备签名。");
        verify("revision",[this.id,name,row.from,row.data],row.sig,author.sig);
        return un64(row.data);
    }
}
// Seal contents as well as IDs: a former member still holds the old signing and epoch keys.
async function historyDigest(revisions) {
    const ids=[...revisions.keys()].sort();
    return sha(message("frozen-history",ids.map(id=>{
        const rev=revisions.get(id);
        return [id,rev.path,rev.parents,rev.hash];
    })));
}
function epochStores(dav,policies,device,keys) {
    return Promise.all(policies.map(async({p},i)=>new EpochStore(dav,p,device,await aes(un64(keys[i])),policies[i+1]?.p.frozen??null)));
}
async function verifiedHistory(epochs,policies) {
    const all=new Map(),locations=new Map();
    for (const [i,epoch] of epochs.entries()) {
        const expected=policies[i].p.historyDigest;
        if(expected)check(await historyDigest(all)===expected,"历史修订内容与管理员签名的封存记录不符。");
        for(const [id,rev] of await epoch.history(new Map())) {
            check(!all.has(id),"重复修订编号。");
            all.set(id,rev);
            locations.set(id,epoch);
        }
    }
    return {all,locations};
}
async function storeFor(dav,policies,device) {
    const {p}=policies.at(-1);
    const keys=await openRing(device,p.boxes[device.id],[p.anchor,p.n,device.id]);
    check(keys.length===policies.length,"历史密钥不完整。");
    const epochs=await epochStores(dav,policies,device,keys);
    let locations=new Map();
    return {
        async history(){
            const verified=await verifiedHistory(epochs,policies);
            locations=verified.locations;
            return verified.all;
        },
        readBody:rev=>locations.get(rev.id).readBody(rev),
        async publish(...args){
            await assertLatest(dav,p.n);
            const rev=await epochs.at(-1).publish(...args);
            await assertLatest(dav,p.n);
            locations.set(rev.id,epochs.at(-1));return rev;
        }
    };
}
async function assertLatest(dav,n){
    try {await readPolicy(dav,n+1);}catch(e){if(e.status===404)return;throw e;}
    throw Error("授权已变化，请重新同步。");
}
module.exports={freshSeed,identity,genesis,chain,nextPolicy,storeFor,requestPair,readRequest,publicDevice,assertLatest,fingerprint};
