const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/core.cjs");
const {seedSnapshot} = require("../src/personal.cjs");
const {ChunkTransfer,blockSize,threshold,chunkName} = require("../src/transfer.cjs");

class Cache extends Map {
    async get(slot) { return structuredClone(super.get(JSON.stringify(slot))); }
    async put(slot,value) { super.set(JSON.stringify(slot),structuredClone(value)); }
    async remove(slot) { this.delete(JSON.stringify(slot)); }
    async clearDownload(scope,id) {
        for (const slot of this.keys()) {
            const key=JSON.parse(slot);
            if(key[0]===scope && key[1]==="get" && key[2]===id)this.delete(slot);
        }
    }
}
const networkError = status=>Object.assign(Error("test failure"),{status});
async function fixture() {
    const files=new Map(), cache=new Cache(), progress=[];
    const dav={
        async put(name,packet){files.set(name,packet);},
        async read(name){if(!files.has(name))throw networkError(404);return files.get(name);},
        async mkdir(name){files.set(name,true);},
        async list(){return [...files.keys()].filter(s=>s.startsWith("commits/")).map(s=>s.slice(8));}
    };
    const key=await crypto.subtle.generateKey({name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
    const client=(enabled=true)=>new core.Store(dav,"vault",key,new ChunkTransfer(cache,{
        enabled,wait:async()=>{},progress:e=>progress.push({...e})
    }));
    const data=new Uint8Array(threshold+59);
    for(let i=0;i<data.length;i++)data[i]=(i*17)%251;
    return {files,cache,progress,dav,client,data};
}

test("interrupted chunk PUT survives a restarted client; a lost acknowledgement never duplicates its block", async()=>{
    const {files,dav,client,data,progress,cache}=await fixture();
    let offline=false,puts=0;const put=dav.put,read=dav.read;
    dav.put=async(n,b)=>{
        if(offline)throw networkError(503);
        await put(n,b);
        if(n.startsWith("objects/b-") && ++puts===3){offline=true;throw networkError(503);}
    };
    dav.read=async n=>{if(offline)throw networkError(503);return read(n);};
    await assert.rejects(client().publish("附件.pdf",[],data));
    assert.equal((await dav.list()).length,0);assert.equal(files.size,3);
    assert.deepEqual(progress.filter(e=>e.retry).map(e=>e.retry),[1,2,3]);
    const slot=["personal/vault","put","附件.pdf"];
    const previous=await cache.get(slot);
    delete previous.probeThrough; // 0.3.8 tracked only the next uncertain PUT.
    await cache.put(slot,previous);
    offline=false;
    const rev=await client().publish("附件.pdf",[],data);
    assert.equal(puts,9);assert.equal((await dav.list()).length,1);
    assert.deepEqual(new Uint8Array(await client(false).readBody(rev)),data);
    assert.equal(rev.parts.size,data.length);
    assert.ok([...files.keys()].every(k=>!k.includes(rev.hash) && !k.includes("附件")));
    assert.ok(!Buffer.from([...files.values()][0]).includes(data.subarray(0,100)));
});

test("download restarts at missing blocks, verifies cached bytes and refuses corrupted ciphertext",async()=>{
    const {files,dav,client,data,cache}=await fixture(), rev=await client().publish("x",[],data);
    let gets=0,broken=true;
    const read=dav.read, seen=[];
    dav.read=async n=>{
        if(++gets>=4 && broken)throw networkError(503);
        seen.push(n);return read(n);
    };
    await assert.rejects(client().readBody(rev));assert.equal(cache.size,3);
    broken=false;
    const first=[...seen], archived=files.get(seen[0]), missing=seen[0];
    files.delete(missing);
    await assert.rejects(client().readBody(rev,{audit:true}), e=>e.status===404);
    assert.equal(cache.size,3);
    files.set(missing,archived);
    seen.length=0;
    assert.deepEqual(new Uint8Array(await client().readBody(rev)),data);
    assert.equal(seen.length,6);assert.ok(first.every(n=>!seen.includes(n)));assert.equal(cache.size,0);
    const damaged=new Uint8Array(files.get(first[0]));damaged[20]^=255;
    await assert.rejects(client().readBody(rev));assert.equal(cache.size,3);
    damaged[20]^=255; seen.length=0;
    assert.deepEqual(new Uint8Array(await client().readBody(rev)),data);
    assert.equal(seen.length,6);assert.equal(cache.size,0);
});

test("permanent errors are not retried; a changed attachment never resumes the old version",async()=>{
    const {dav,client,data,progress,files}=await fixture();
    const original=dav.put;let count=0;
    dav.put=async(n,b)=>{if(++count===2)throw networkError(403);return original(n,b);};
    await assert.rejects(client().publish("x",[],data));assert.equal(progress.filter(e=>e.retry).length,0);
    const first=[...files.keys()][0];dav.put=original;
    data[0]^=1;
    const rev=await client().publish("x",[],data);
    files.delete(first);
    assert.deepEqual(new Uint8Array(await client().readBody(rev)),data);
});

test("setup resumes an interrupted eight-block batch, authenticates uncertain blocks and audits every block",async()=>{
    const {client,dav,data,cache,files}=await fixture();
    const source=new Map([["before.md",Uint8Array.of(1)],["audio.bin",data],["after.md",Uint8Array.of(2)]]);
    const local={paths:()=>new Set(source.keys()),allowed:()=>true,read:async path=>source.get(path)};
    const run=async limit=>{
        const store=client();
        store.reads.limit=limit;
        return seedSnapshot(store,local,()=>true);
    };
    const originalPut=dav.put, originalRead=dav.read;
    let release;
    const ready=new Promise(resolve=>{release=resolve;});
    const attempted=new Set(), acknowledged=new Set();
    dav.put=async(name,packet)=>{
        if (!name.startsWith("objects/b-") || packet.byteLength!==blockSize+28) return originalPut(name,packet);
        attempted.add(name);
        const order=attempted.size;
        if (order===8) release();
        await ready;
        if (order===2) throw networkError(403); // This block never reached WebDAV.
        await originalPut(name,packet);
        acknowledged.add(name);
        if (order===5) throw networkError(403); // Saved, but no acknowledgement.
    };
    await assert.rejects(run(8),e=>e.status===403);
    assert.equal(attempted.size,8);
    assert.equal(acknowledged.size,7);
    assert.equal((await dav.list()).length,1);
    const checkpoint=await cache.get(["personal/vault","put","audio.bin"]);
    assert.equal(checkpoint.done,0);
    assert.equal(checkpoint.probeThrough,8);
    const blocks=new Set();
    for (let i=0;i<9;i++) blocks.add("objects/b-"+await chunkName(checkpoint.parts,i));
    const probes=[], audit=[];
    dav.read=async name=>{
        if (blocks.has(name)) ((await dav.list()).length===1 ? probes : audit).push(name);
        return originalRead(name);
    };
    dav.put=async(name,packet)=>{
        assert(!acknowledged.has(name),"an authenticated block must not be uploaded again");
        await originalPut(name,packet);
    };
    const {baseline,history}=await run(4); // A later attempt can use a narrower window.
    assert.deepEqual(new Set(probes),attempted);
    assert.equal(probes.length,8);
    assert.deepEqual(new Set(audit),blocks);
    assert.equal(audit.length,9);
    assert.equal(history.size,3);
    assert.equal(baseline.get("audio.bin").hash,await core.sha(data));
    assert.equal(cache.size,0);
    assert.equal(files.size,17); // 3 markers, 3 metadata, 2 note bodies and 9 blocks.
});

test("mixed setup shares twenty network slots between whole files and large attachments in both directions",async()=>{
    const {client,dav,files}=await fixture();
    const data=new Uint8Array(24*blockSize+59);
    const store=client(), source=new Map();
    store.reads.limit=20;
    for (let i=0;i<22;i++) source.set(i+".md",Uint8Array.of(i));
    source.set("first.bin",data);
    source.set("last.md",Uint8Array.of(42));
    source.set("second.bin",data);
    let inflight=0, peak=0;
    const blockPeaks={};
    for (const method of ["put","read"]) {
        const original=dav[method];
        let release, blocks=0;
        const firstWave=new Promise(resolve=>{release=resolve;});
        blockPeaks[method]=0;
        dav[method]=async(name,packet)=>{
            peak=Math.max(peak,++inflight);
            try {
                if ((packet ?? files.get(name))?.byteLength===blockSize+28) {
                    blockPeaks[method]=Math.max(blockPeaks[method],++blocks);
                    if (blocks===20) release();
                    await firstWave;
                    await new Promise(setImmediate);
                    blocks--;
                }
                return await original(name,packet);
            } finally { inflight--; }
        };
    }
    const {baseline}=await seedSnapshot(store,{
        paths:()=>new Set(source.keys()),allowed:()=>true,read:async path=>source.get(path)
    },()=>true);
    assert.equal(peak,20);
    assert.deepEqual(blockPeaks,{put:20,read:20});
    assert.equal(baseline.size,source.size);
});

test("whole-file and chunk downloads share one limit and retry a throttled block without repeating successful reads",async()=>{
    const {dav,client,data}=await fixture(), store=client();
    for (let i=0;i<10;i++) await store.publish(i+".md",[],Uint8Array.of(i));
    const attachment=await store.publish("audio.bin",[],data);
    await store.publish("after.md",[],Uint8Array.of(31));
    const blockNames=new Set();
    for(let i=0;i<9;i++) blockNames.add("objects/b-"+await chunkName(attachment.parts,i));
    const read=dav.read, completed=new Set();
    let active=0, peak=0, chunkPeak=0, throttled=false, afterLimit;
    let release;
    const firstBlocks=new Promise(resolve=>{release=resolve;});
    dav.read=async name=>{
        if(!name.startsWith("objects/b-")) return read(name);
        const n=++active;
        peak=Math.max(peak,n);
        const chunk=blockNames.has(name);
        if(chunk) {
            chunkPeak=Math.max(chunkPeak,n);
            if(n===8) release();
            await firstBlocks;
        }
        await new Promise(setImmediate);
        active--;
        if(chunk && !throttled) { throttled=true; throw networkError(429); }
        if(throttled && !chunk) afterLimit=store.reads.limit;
        assert(!completed.has(name)); completed.add(name);
        return read(name);
    };
    store.reads.limit=8;
    const files=new Map();
    const local={paths:()=>new Set(files.keys()),allowed:()=>true,read:async p=>files.get(p)??null,
        apply:async(p,previous,body)=>{assert.equal(previous,null);files.set(p,body);}};
    const result=await core.synchronize({store,local,baseline:new Map(),cache:new Map(),checkpoint(){}});
    assert.equal(result.received,12); assert.equal(result.sent,0);
    assert.equal(peak,8); assert.equal(chunkPeak,8); assert.equal(afterLimit,4);
    assert.equal(completed.size,20);
    assert.deepEqual(new Uint8Array(files.get("audio.bin")),data);
});

test("initial chunk upload lowers in stages and verifies uncertain PUTs before retrying",async()=>{
    const {client,dav}=await fixture(), store=client();
    const data=new Uint8Array(25*blockSize);
    const put=dav.put, accepted=new Set(), lowered=[];
    let lost, missing;
    store.reads.limit=20;
    store.reads.onLower=level=>lowered.push(level);
    dav.put=async(name,packet)=>{
        if (name.startsWith("objects/b-")) {
            if (!lost) {
                lost=name; accepted.add(name);
                await put(name,packet);
                throw networkError(503);
            }
            missing ??= name;
            if (name===missing && store.reads.limit>8) throw networkError(429);
            assert(!accepted.has(name));
            accepted.add(name);
        }
        return put(name,packet);
    };
    const {baseline}=await seedSnapshot(store,{
        paths:()=>new Set(["video.bin"]),allowed:()=>true,read:async()=>data
    },()=>true);
    assert.deepEqual(lowered,[12,8]);
    assert.equal(accepted.size,25);
    assert.equal(baseline.get("video.bin").hash,await core.sha(data));
});

test("small files, deletions and a large file without opt-in keep the old whole-object format",async()=>{
    const {dav,client,data}=await fixture(), store=client(false);
    for(const bytes of [data,new Uint8Array(0),null]){
        const rev=await store.publish("x",[],bytes);assert.equal(rev.parts,undefined);
        if(bytes)assert.deepEqual(new Uint8Array(await client().readBody(rev)),bytes);
    }
    const small=await client().publish("y",[],new Uint8Array(blockSize));
    assert.equal(small.parts,undefined);assert.equal((await dav.list()).length,4);
});

test("a transient error before the server receives a block retries the missing PUT and completes", async () => {
    const {dav,client,data,progress} = await fixture();
    const put = dav.put;
    let failedName, writes = 0;
    dav.put = async (name, packet) => {
        if (name.startsWith("objects/b-")) {
            if (!failedName) {
                failedName = name;
                throw networkError(429);
            }
            writes++;
        }
        return put(name, packet);
    };
    const store = client();
    const rev = await store.publish("retry.bin", [], data);
    assert.equal(writes, Math.ceil(data.length / blockSize));
    assert.deepEqual(progress.filter(e => e.retry).map(e => e.retry), [1]);
    assert.deepEqual(new Uint8Array(await store.readBody(rev)), data);
});

test("an exact-threshold attachment has eight authenticated blocks and rejects exchanged blocks", async () => {
    const {files,client,data} = await fixture();
    const store = client(), bytes = data.subarray(0,threshold);
    const rev = await store.publish("boundary.bin", [], bytes);
    const parts = [...files.keys()].filter(name => name.startsWith("objects/b-"));
    assert.equal(parts.length, threshold / blockSize);
    assert.deepEqual(new Uint8Array(await store.readBody(rev)), bytes);
    files.set(parts[0], files.get(parts[1]));
    await assert.rejects(store.readBody(rev));
});
