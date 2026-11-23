const test=require("node:test");
const assert=require("node:assert/strict");
const core=require("../src/core.cjs");
const {periods,day,maintain,setPeriod,revisionIndex,snapshot,restore,headIds}=require("../src/history.cjs");
const {blockSize,chunkName}=require("../src/transfer.cjs");
const bytes=s=>new TextEncoder().encode(s).buffer;
const missing=()=>Object.assign(Error("missing object"),{status:404});

async function fixture() {
    const files=new Map(), times=new Map(), commits=new Set();
    let policyDirectory=false;
    const dav={
        async read(k){if(!files.has(k))throw missing();return files.get(k);},
        async put(k,v){files.set(k,v);},
        async mkdir(k){
            if(k==="history-policy"){
                if(policyDirectory)throw Object.assign(Error("exists"),{status:405});
                policyDirectory=true;return;
            }
            commits.add(k.slice(8));
        },
        child(k){
            const dir=k+"/";
            return {put:(n,b)=>dav.put(dir+n,b),child:n=>({root:dir+n}),async call(m,n,accepted,opts){
                if(m==="DELETE"){files.delete(dir+n);return {status:204};}
                assert.equal(m,"MOVE");assert.equal(opts.headers.Overwrite,"F");
                const to=opts.headers.Destination;
                if(files.has(to))return {status:412};
                files.set(to,await dav.read(dir+n));files.delete(dir+n);return {status:201};
            }};
        },
        async list(k,dates){
            if(k==="history-policy"){
                if(!policyDirectory)throw missing();
                return [...files.keys()].filter(n=>n.startsWith(k+"/")).map(n=>n.slice(k.length+1));
            }
            if(k==="objects")return [...files.keys()].filter(n=>n.startsWith("objects/")).map(n=>n.slice(8));
            assert.equal(k,"commits");
            if(dates)for(const [id,time] of times)dates.set(id,time);
            return [...commits];
        },
        async call(method,k,accepted,options){
            if(method==="DELETE"){assert(k.startsWith("objects/b-"));files.delete(k);return {status:204};}
            throw Error("Unexpected method: "+method);
        }
    };
    const id=core.randomId(),key=await crypto.subtle.generateKey({name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
    const store=new core.Store(dav,id,key);
    // Manufacture old and pre-timestamp revisions while exercising encrypted metadata round trips.
    async function publish(path,parents,body,age=0,legacy=false){
        const r=await store.publish(path,parents,body===null?null:bytes(body));
        if(legacy)delete r.time;else r.time=Date.now()-age*day;
        await store.writeObject("r-"+r.id,core.jsonBytes(r));return r;
    }
    return {store,peer:new core.Store(dav,id,key),files,times,publish,dav};
}

test("retention choices share an encrypted per-vault policy and retain the active version across every cutoff",async()=>{
    const {store,peer,publish,files}=await fixture();
    const old=await publish("daily.md",[],"old",400), head=await publish("daily.md",[old.id],"current",75);
    const whole=await store.history(new Map());
    assert.equal((await peer.readHistoryPolicy()).days,30);
    for(const days of periods){
        await setPeriod(store,days);const p=await peer.readHistoryPolicy();assert.equal(p.days,days);
        const ix=revisionIndex(whole,p);
        assert.equal(ix.available(old),days===0||days>75);assert(ix.available(head));
    }
    assert(!Buffer.from(files.get("history-policy/v-"+(await peer.readHistoryPolicy()).generation)).includes(Buffer.from('"days"')));
    await assert.rejects(setPeriod(store,7));
});

test("retention polling skips unchanged snapshots and falls back when HEAD is unsupported",async()=>{
    const {store,peer,dav,files}=await fixture();
    let headSupported=true, lists=0;
    const list=dav.list.bind(dav), probes=[];
    dav.list=async(...args)=>{lists++;return list(...args);};
    dav.call=async(method,path,accepted,opts)=>{
        assert.equal(method,"HEAD");
        assert.equal(opts.headers["Cache-Control"],"no-cache");
        probes.push(path);
        return {status:headSupported ? (files.has(path)?200:404) : 405};
    };
    assert.equal(await peer.readHistoryPolicy(0),null);
    assert.equal(lists,0);
    await setPeriod(store,60);
    await setPeriod(store,90);
    const policy=await peer.readHistoryPolicy(0);
    assert.deepEqual([policy.days,policy.generation],[90,2]);
    lists=0;
    assert.equal(await peer.readHistoryPolicy(2),null);
    assert.equal(lists,0);
    headSupported=false;
    assert.equal(await peer.readHistoryPolicy(2),null);
    assert.equal(lists,1);
    await setPeriod(store,180);
    assert.equal((await peer.readHistoryPolicy(2)).days,180);
    assert.deepEqual(probes,["history-policy/v-1","history-policy/v-1",...Array(3).fill("history-policy/v-3")]);
});

test("legacy dates, expiry boundary, incomplete cleanup and a late offline branch",async()=>{
    const {store,publish,times,files,dav}=await fixture();
    const base=await publish("a.md",[],"base",0,true), left=await publish("a.md",[base.id],"left",0,true);
    times.set(left.id,Date.now()-45*day);
    const snap=await snapshot(store,new Map());
    assert(snap.index.date(base)>Date.now()-day);assert.equal(snap.index.date(left),times.get(left.id));
    assert(!revisionIndex(snap.history,snap.policy,times.get(left.id)+30*day-1).due(base));
    assert(revisionIndex(snap.history,snap.policy,times.get(left.id)+30*day).due(base));
    const call=dav.call;let failed=false;
    dav.call=async(m,...a)=>{if(m==="DELETE"&&!failed){failed=true;throw Error("offline");}return call(m,...a);};
    await assert.rejects(maintain(store,snap.history),/offline/);
    assert.deepEqual((await store.readHistoryPolicy()).pending,[base.id]);
    await maintain(store,snap.history);
    assert(!files.has("objects/b-"+base.id));assert(files.has("objects/r-"+base.id));
    assert.deepEqual((await store.readHistoryPolicy()).pending,[]);
    assert.equal(await store.readMergeBase(base),null);
    // A failure fetching a non-expired base must still surface as a storage error.
    const local=new Map([["a.md",bytes("right")]]), backup=new Set(), checkpoint=new Map([["a.md",{ids:[base.id],hash:base.hash}]]);
    const result=await core.synchronize({store,cache:new Map(),baseline:checkpoint,checkpoint(){},local:{
        paths:()=>new Set(local.keys()),allowed:()=>true,read:async p=>local.get(p),
        archive:async(r,body)=>{await body();backup.add(r.hash);}
    }});
    assert.deepEqual(result.conflicts,["a.md"]);assert.equal(backup.size,2);
    files.delete("objects/b-"+left.id);await assert.rejects(store.readMergeBase(left),/missing/);
});

test("retention preserves open conflicts and recently superseded old notes; a concurrent forever setting wins",async()=>{
    const {store,peer,publish,files}=await fixture();
    const root=await publish("split.md",[],"root",200);
    await publish("split.md",[root.id],"left",100);await publish("split.md",[root.id],"right",90);
    const recent=await publish("live.md",[],"original",350);
    await publish("live.md",[recent.id],"change today");
    const past=await publish("history.md",[],"old",300);await publish("history.md",[past.id],"new",100);
    const all=await store.history(new Map());
    const write=store.saveHistoryPolicy.bind(store);let raced=false;
    store.saveHistoryPolicy=async p=>{if(!raced){raced=true;await setPeriod(peer,0);}return write(p);};
    await maintain(store,all);assert.equal((await peer.readHistoryPolicy()).days,0);
    assert(files.has("objects/b-"+past.id));
    await setPeriod(peer,30);await maintain(store,all);
    assert(files.has("objects/b-"+root.id));assert(files.has("objects/b-"+recent.id));assert(!files.has("objects/b-"+past.id));
    await setPeriod(peer,0);assert(!(await snapshot(peer,new Map())).index.available(past));
});

test("chunk cleanup resumes beyond the per-sync budget and keeps the current attachment",async()=>{
    const {store,publish,files}=await fixture();
    const old=await publish("video.bin",[],"old",80);const head=await publish("video.bin",[old.id],"new",60);
    old.parts={v:1,size:27*blockSize,seed:core.randomId()};
    files.delete("objects/b-"+old.id);
    for(let n=0;n<27;n++)files.set("objects/b-"+await chunkName(old.parts,n),bytes("block"));
    await store.writeObject("r-"+old.id,core.jsonBytes(old));
    const history=await store.history(new Map());
    assert.deepEqual((await maintain(store,history)).pending,[old.id]);
    assert.deepEqual((await maintain(store,history)).pending,[]);
    assert.deepEqual([...files.keys()].filter(k=>k.startsWith("objects/b-")),["objects/b-"+head.id]);
});

test("restore publishes a new revision, syncs to another device and recovers a deleted file",async()=>{
    const {store,peer,publish}=await fixture();
    const path="笔记.md",old=await publish(path,[],"最初"),current=await publish(path,[old.id],"今天");
    const contents=new Map([[path,bytes("今天")]]),baseline=new Map();
    const local={paths:()=>new Set(contents.keys()),allowed:()=>true,read:async p=>contents.get(p)??null,
        apply:async(p,h,b)=>{assert.equal(contents.has(p)?await core.sha(contents.get(p)):null,h);
            if(b===null)contents.delete(p);else contents.set(p,b);}};
    const args={store,local,cache:new Map(),baseline,checkpoint(){},active:()=>true};
    const preview={path,headIds:[current.id],revisionId:old.id,localHash:current.hash};
    const next=await restore({...args,preview});
    assert.deepEqual(next.parents,[current.id]);assert.equal(next.hash,old.hash);
    await assert.rejects(restore({...args,preview}),/已变化/);
    const selected={...preview,headIds:[next.id],localHash:next.hash,revisionId:current.id};
    contents.set(path,bytes("尚未同步的改动"));await assert.rejects(restore({...args,preview:selected}),/已变化/);
    assert.equal(new TextDecoder().decode(contents.get(path)),"尚未同步的改动");
    const history=await peer.history(new Map());assert.equal(history.size,3);
    const other=new Map([[path,bytes("今天")]]),peerBase=new Map([[path,{ids:[current.id],hash:current.hash}]]);
    await core.synchronize({store:peer,cache:new Map(),baseline:peerBase,checkpoint(){},local:{...local,paths:()=>new Set(other.keys()),
        read:async p=>other.get(p),apply:async(p,h,b)=>other.set(p,b)}});
    assert.equal(new TextDecoder().decode(other.get(path)),"最初");
    const gone=await publish(path,[next.id],null);contents.delete(path);
    const revived=await restore({...args,preview:{path,headIds:[gone.id],revisionId:current.id,localHash:null}});
    assert.deepEqual(revived.parents,[gone.id]);assert.equal(revived.hash,current.hash);
    const redel=await restore({...args,preview:{path,headIds:[revived.id],revisionId:gone.id,localHash:revived.hash}});
    assert.equal(redel.hash,null);assert.deepEqual(headIds(core.headsByPath(await peer.history(new Map())).get(path)),[redel.id]);
});

test("restore rechecks retention and a changed local file during download",async()=>{
    const {store,publish}=await fixture(),path="note.md";
    const old=await publish(path,[],"past",240), newest=await publish(path,[old.id],"current",100);
    let text="current",writes=0;
    const args={store,cache:new Map(),baseline:new Map(),checkpoint(){},active:()=>true,
        local:{allowed:()=>true,read:async()=>bytes(text),apply:async()=>{writes++;}},
        preview:{path,revisionId:old.id,headIds:[newest.id],localHash:newest.hash}};
    await setPeriod(store,0);
    assert((await snapshot(store,new Map())).index.available(old));
    await setPeriod(store,30);
    await assert.rejects(restore(args),/过期/);
    await setPeriod(store,0);
    const read=store.readBody.bind(store);
    store.readBody=async r=>{text="changed during download";return read(r);};
    await assert.rejects(restore(args),/文件已变化/);
    assert.equal(writes,0);assert.equal((await store.history(new Map())).size,2);
});
