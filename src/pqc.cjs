"use strict";
const { ml_kem768: kem } = require("@noble/post-quantum/ml-kem.js");
const { ml_dsa65: dsa } = require("@noble/post-quantum/ml-dsa.js");
const core = require("./core.cjs");
const { jsonBytes, parseBytes, randomId, sha } = core;
const suite = "homebound-pqc-preview-2";
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
    check(typeof seed==="string" && un64(seed).length===32 && b64(un64(seed))===seed,"无效的 256 位种子。");
    const master=await crypto.subtle.importKey("raw",un64(seed),"HKDF",false,["deriveBits"]);
    const derive=async (purpose,size)=>new Uint8Array(await crypto.subtle.deriveBits({
        name:"HKDF",hash:"SHA-256",salt:jsonBytes(suite), info:jsonBytes([label,purpose])
    },master,size*8));
    const enc=kem.keygen(await derive("kem",64)), sig=dsa.keygen(await derive("signature",32));
    const token=b64(await derive("ledger-capability",32));
    const pub={kem:b64(enc.publicKey),sig:b64(sig.publicKey),cap:await sha(new TextEncoder().encode(token))};
    return {pub,token,id:await fingerprint([pub.kem,pub.sig,pub.cap]),enc:enc.secretKey,sign:sig.secretKey};
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
const digestOf=text=>sha(new TextEncoder().encode(text));
const publicId=pub=>fingerprint([pub.kem,pub.sig,pub.cap]);
const latest=state=>state.policies.at(-1);
function publicDevice(device,name){
    check(typeof name==="string" && name.trim() && name.length<=64,"请输入设备名称（1 至 64 字）。");
    return {...device.pub,name:name.trim()};
}
async function state(ledger,anchor,pin,withRevisions=true) {
    check(idPattern.test(anchor),"库指纹无效。");
    const nonce=randomId(), snapshot=await ledger("state",{anchor,nonce,withRevisions});
    check(snapshot.nonce===nonce && snapshot.policies.length>0,"可信提交服务未提供当前状态。");
    const policies=[];
    let linked=false;
    for(const raw of snapshot.policies){
        const {policy:p,sig}=JSON.parse(raw),prev=policies.at(-1);
        check(p.suite===suite && p.n===policies.length && p.anchor===anchor && p.parent===(prev?.digest||""),"授权链不匹配。");
        if(!prev)check(await publicId(p.recovery)===anchor && p.by==="recovery","初始恢复身份不匹配。");
        const prior=prev?.p||p;
        check(p.by==="recovery" || p.by===prior.admin,"无管理权限。");
        verify("policy",[p],sig,p.by==="recovery"?prior.recovery.sig:prior.members[prior.admin].sig);
        check(p.members[p.admin] && (p.by==="recovery"||JSON.stringify(p.recovery)===JSON.stringify(prior.recovery)),"无效恢复根。");
        if(p.keyLink!==undefined){
            check(prev && typeof p.keyLink==="string" && un64(p.keyLink).length===60,"历史密钥链接损坏。");
            linked=true;
        }else check(!linked,"历史密钥格式发生回退。");
        const digest=await digestOf(raw);
        if(pin?.n===p.n)check(pin.digest===digest,"授权记录已被替换。");
        policies.push({p,digest});
    }
    check(!pin||pin.n<policies.length,"授权记录回退。");
    return {policies,rows:snapshot.revisions};
}
async function signPolicy(ledger,p,actor,keys,token=actor.token){
    p.boxes={};
    for(const [id,m] of Object.entries(p.members))p.boxes[id]=await envelope(m,keys,[p.anchor,p.n,id]);
    p.recoveryBox=await envelope(p.recovery,keys,[p.anchor,p.n,"recovery"]);
    const row=JSON.stringify({policy:p,sig:signed("policy",[p],actor.sign)});
    const result=await ledger("policy",{head:p.parent,row},token);
    check(result.digest===await digestOf(row),"提交服务返回了不同的授权摘要。");
    return {p,digest:result.digest};
}
async function genesis(ledger,device,name,recovery,bootstrap){
    const p={suite,n:0,parent:"",by:"recovery",anchor:recovery.id,recovery:recovery.pub,admin:device.id,members:{[device.id]:publicDevice(device,name)}};
    await signPolicy(ledger,p,recovery,[freshSeed()],bootstrap);
}
const lifetime=10*60*1000;
async function requestPair(dav,s,device,name){
    const {p,digest}=latest(s),pub=publicDevice(device,name);
    const request={anchor:p.anchor,head:digest,nonce:randomId(),expires:Date.now()+lifetime,pub};
    const code=await fingerprint([request]);
    await dav.child("requests").put(code,jsonBytes({request,sig:signed("join",[request],device.sign)}).buffer);
    return code;
}
async function readRequest(dav,s,code){
    check(idPattern.test(code),"配对码格式错误。");
    const {request,sig}=parseBytes(await dav.child("requests").read(code));
    const {p,digest}=latest(s);
    check(request.anchor===p.anchor && request.head===digest,"配对申请已过期或已使用。");
    check(Number.isSafeInteger(request.expires)&&request.expires>=Date.now()&&request.expires<=Date.now()+lifetime+60000,"配对申请已过期。");
    check(idPattern.test(request.nonce)&&await fingerprint([request])===code,"配对码被替换。");
    verify("join",[request],sig,request.pub.sig);
    return {id:await publicId(request.pub),pub:request.pub,expires:request.expires,head:digest};
}
async function nextPolicy(ledger,s,actor,action,arg){
    const {p,digest}=latest(s),restoring=action==="restore";
    const recoveryId=await publicId(p.recovery);
    check(restoring?actor.id===recoveryId:actor.id===p.admin,"恢复身份或管理员不匹配。");
    const keys=await openRing(actor,restoring?p.recoveryBox:p.boxes[actor.id],[p.anchor,p.n,restoring?"recovery":actor.id]);
    check(keys.length===(p.keyLink?1:p.n+1),"当前代密钥记录不完整。");
    let members={...p.members},admin=p.admin,recovery=p.recovery;
    if(restoring){
        check(arg.id!==p.admin && !members[arg.id] && await publicId(arg.recovery)!==recoveryId,"请生成新的设备身份和恢复码。");
        members={[arg.id]:arg.pub};admin=arg.id;recovery=arg.recovery;
    }else if(action==="revoke"){
        check(arg!==admin&&members[arg],"无法撤销该设备。");delete members[arg];
    }else if(action==="approve"){
        check(!members[arg.id] && arg.expires>=Date.now() && arg.head===digest,"配对申请失效。");members[arg.id]=arg.pub;
    }else check(action==="seal-history","未知操作。");
    // A policy transaction is independent of the DAV data plane. Damaged bodies cannot veto rotation.
    const next={suite,n:p.n+1,parent:digest,anchor:p.anchor,by:restoring?"recovery":actor.id,recovery,admin,members};
    // A new key unlocks its predecessor. Possession of an old key cannot unlock a successor.
    const current=freshSeed();
    next.keyLink=b64(await encrypt(un64(current),[suite,p.anchor,next.n,digest,"previous-key"],un64(keys.at(-1))));
    if(!p.keyLink && p.n>0){
        next.legacyKeys=b64(await encrypt(un64(current),[suite,p.anchor,next.n,digest,"legacy-keys"],jsonBytes(keys.slice(0,-1))));
    }
    return signPolicy(ledger,next,actor,[current]);
}
async function encrypt(rawKey,label,bytes){
    const iv=random(12),cipher=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:jsonBytes(label)},await aes(rawKey),bytes);
    const packet=new Uint8Array(12+cipher.byteLength);packet.set(iv);packet.set(new Uint8Array(cipher),12);return packet;
}
async function decrypt(rawKey,label,packet){
    const a=new Uint8Array(packet);
    return crypto.subtle.decrypt({name:"AES-GCM",iv:a.subarray(0,12),additionalData:jsonBytes(label)},await aes(rawKey),a.subarray(12));
}
function validateGraph(revisions){
    // Revisions are returned in the sequencer's committed order. Parents must precede children.
    const seen=new Map();
    for(const r of revisions){
        check(idPattern.test(r.id)&&!seen.has(r.id)&&core.safePath(r.path)&&!core.isRecovery(r.path),"无效的修订或路径。");
        if(!Array.isArray(r.parents) || new Set(r.parents).size!==r.parents.length ||
            !r.parents.every(id=>seen.get(id)?.path===r.path)){
            throw Object.assign(Error("修订图缺少父项、含环或路径不一致："+r.path+" ["+r.id+"]"),{path:r.path,id:r.id});
        }
        check(r.hash===null||/^[a-f0-9]{64}$/.test(r.hash),"无效的正文摘要。");
        seen.set(r.id,r);
    }
    return seen;
}
async function storeFor(ledger,dav,s,device){
    const {p,digest}=latest(s);
    const envelopeKeys=await openRing(device,p.boxes[device.id],[p.anchor,p.n,device.id]);
    let ring=envelopeKeys;
    if(p.keyLink){
        check(envelopeKeys.length===1,"当前代密钥记录不完整。");
        ring=new Array(p.n+1);
        let n=p.n;
        ring[n]=envelopeKeys[0];
        while(n>0 && s.policies[n].p.keyLink){
            const policy=s.policies[n].p;
            const previous=await decrypt(un64(ring[n]),[suite,p.anchor,n,policy.parent,"previous-key"],un64(policy.keyLink));
            ring[--n]=b64(previous);
        }
        if(n>0){
            // The authenticated bridge is stored once, even for a full beta.2 keyring.
            const bridge=s.policies[n+1].p.legacyKeys;
            check(typeof bridge==="string","缺少旧版历史密钥。");
            const legacy=parseBytes(await decrypt(un64(ring[n+1]),[suite,p.anchor,n+1,s.policies[n].digest,"legacy-keys"],un64(bridge)));
            check(legacy.length===n && legacy.every(k=>typeof k==="string"&&un64(k).length===32),"旧版密钥记录不完整。");
            for(let i=0;i<n;i++)ring[i]=legacy[i];
        }
    }
    check(ring.length===s.policies.length,"密钥记录不完整。");
    const bodies=dav.child("objects"), revisions=[];
    let previousEpoch=-1;
    for(const raw of s.rows){
        const {record:r,sig}=JSON.parse(raw),policy=s.policies[r.epoch];
        check(policy && r.anchor===p.anchor && r.head===policy.digest && r.epoch>=previousEpoch && policy.p.members[r.from],"非法写入代际或作者。");
        verify("revision",[r],sig,policy.p.members[r.from].sig);
        const rev=parseBytes(await decrypt(un64(ring[r.epoch]),[suite,p.anchor,r.epoch,r.id,"manifest"],un64(r.payload)));
        check(rev.id===r.id && (rev.hash===null?rev.key===null:typeof rev.key==="string"&&un64(rev.key).length===32),"修订记录异常。");
        revisions.push(rev);previousEpoch=r.epoch;
    }
    const history=validateGraph(revisions);
    return {
        async history(){return new Map(history);},
        async readBody(rev){
            const body=await decrypt(un64(rev.key),[suite,p.anchor,rev.id,"body"],await bodies.read(rev.id));
            check(await sha(body)===rev.hash,"正文校验失败。");return body;
        },
        async publish(path,parents,bytes){
            const id=randomId(),contentKey=bytes===null?null:random(32);
            const rev={id,path,parents,hash:bytes===null?null:await sha(bytes),key:contentKey?b64(contentKey):null};
            validateGraph([...history.values(),rev]);
            if(contentKey)await bodies.put(id,(await encrypt(contentKey,[suite,p.anchor,id,"body"],bytes)).buffer);
            const r={anchor:p.anchor,head:digest,epoch:p.n,id,from:device.id,
                payload:b64(await encrypt(un64(ring[p.n]),[suite,p.anchor,p.n,id,"manifest"],jsonBytes(rev)))};
            const row=JSON.stringify({record:r,sig:signed("revision",[r],device.sign)});
            const receipt=await ledger("commit",{head:digest,row},device.token);
            check(receipt.digest===await digestOf(row),"写入回执无效。");history.set(id,rev);return rev;
        }
    };
}
async function auditData(store){
    const history=await store.history(),faults=[];
    for(const rev of history.values())if(rev.hash!==null){
        try{await store.readBody(rev);}catch{faults.push({id:rev.id,path:rev.path});}
    }
    return {checked:history.size,faults};
}
module.exports={identity,freshSeed,publicDevice,publicId,genesis,state,latest,requestPair,readRequest,nextPolicy,storeFor,auditData,validateGraph};
