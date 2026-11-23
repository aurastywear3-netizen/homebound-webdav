"use strict";

const {headsByPath,sha,safePath} = require("./core.cjs");
const {validParts,blockSize,chunkName} = require("./transfer.cjs");
const day = 86400000;
const periods = [30,60,90,180,0]; // Zero means forever.
const validTime = time => Number.isSafeInteger(time) && time>0;

// Policy changes and expiration decisions share one encrypted conditional write.
// A client that loses a race re-evaluates expiry under the winning policy.
async function updatePolicy(store,change) {
    for (let attempt=0;attempt<5;attempt++) {
        const policy=await store.readHistoryPolicy();
        if (!change(policy) || await store.saveHistoryPolicy(policy)) return policy;
    }
    throw Error("其他设备正在更新历史记录，请稍后重试。");
}

async function setPeriod(store,days) {
    if (!periods.includes(days)) throw Error("无效的历史保留期限。");
    return updatePolicy(store,policy=>{
        if (policy.days===days) return false;
        policy.days=days; return true;
    });
}

async function loadDates(store,history,policy) {
    const missing=[...history.values()].filter(r=>!validTime(r.time) && !policy.dates[r.id]);
    if (!missing.length) return policy;
    const dates=new Map();
    await store.dav.list("commits",dates);
    const observed=Date.now();
    return updatePolicy(store,current=>{
        let changed=false;
        for (const r of missing) if (!current.dates[r.id]) {
            current.dates[r.id]=dates.get(r.id) || observed;
            changed=true;
        }
        return changed;
    });
}

function revisionIndex(history,policy,now=Date.now()) {
    const heads=headsByPath(history), superseded=new Map(), conflicts=new Set();
    for (const [path,revs] of heads) if (new Set(revs.map(r=>r.hash)).size>1) conflicts.add(path);
    const date=r=>validTime(r.time) ? r.time : policy.dates[r.id];
    for (const r of history.values()) for (const id of r.parents) {
        // An old current file remains recoverable for a full interval after replacement.
        superseded.set(id,Math.max(superseded.get(id)||0,date(r)||Infinity));
    }
    const expired=new Set(policy.expired);
    const due=r=>!!policy.days && !conflicts.has(r.path) && superseded.has(r.id) &&
        superseded.get(r.id)<=now-policy.days*day;
    const available=r=>!superseded.has(r.id) || (!expired.has(r.id) && !due(r));
    return {heads,superseded,conflicts,expired,date,due,available};
}

async function snapshot(store,cache) {
    const history=await store.history(cache);
    const policy=await loadDates(store,history,await store.readHistoryPolicy());
    return {history,policy,index:revisionIndex(history,policy)};
}

async function maintain(store,history,active=()=>true) {
    const original=await loadDates(store,history,await store.readHistoryPolicy());
    const index=revisionIndex(history,original);
    if (!original.pending.length && ![...history.values()].some(r=>!index.expired.has(r.id) && index.due(r))) return original;
    const policy=await updatePolicy(store,current=>{
        const ix=revisionIndex(history,current);
        const added=[...history.values()].filter(r=>!ix.expired.has(r.id) && ix.due(r));
        for (const r of added) {
            current.expired.push(r.id);
            if (r.hash!==null) current.pending.push(r.id);
        }
        return added.length>0;
    });
    const done=new Set(), retired=new Set(policy.expired);
    let remainingObjects, requests=0;
    const started=Date.now();
    const budget=()=>requests<24 && (requests===0 || Date.now()-started<2000);
    for (const id of policy.pending) {
        const rev=history.get(id);
        if (!budget()) break;
        if (!rev || !retired.has(id) || !index.superseded.has(id) || index.conflicts.has(rev.path)) continue;
        const remove=async name=>{
            if (!active()) throw Error("历史清理已暂停。");
            await store.dav.call("DELETE","objects/b-"+name,[200,204,404]);
            requests++;
        };
        if (rev.parts) {
            if (!validParts(rev.parts)) throw Error("无法识别历史附件分块格式。");
            // Resume a partially collected attachment without spending each sync's
            // entire request budget deleting the same already absent blocks.
            remainingObjects ??=new Set(await store.dav.list("objects"));
            let n=0;
            const count=Math.ceil(rev.parts.size/blockSize);
            for (;n<count && budget();n++) {
                const name=await chunkName(rev.parts,n);
                if (remainingObjects.has("b-"+name)) await remove(name);
            }
            if (n<count) break;
        } else await remove(id);
        done.add(id);
    }
    if (!done.size) return policy;
    return updatePolicy(store,current=>{
        const remaining=current.pending.filter(id=>!done.has(id));
        if (remaining.length===current.pending.length) return false;
        current.pending=remaining; return true;
    });
}

const headIds=heads=>heads.map(r=>r.id).sort();
const digest=bytes=>bytes===null ? null : sha(bytes);

async function restore({store,local,cache,baseline,checkpoint,preview,active}) {
    const {history,index}=await snapshot(store,cache);
    const {path,revisionId,localHash}=preview, rev=history.get(revisionId);
    await local.prepareCopies?.([path],history);
    if (!safePath(path) || !local.allowed(path) || !rev || rev.path!==path || !index.available(rev))
        throw Error("所选历史版本已经过期或无法恢复。");
    const heads=index.heads.get(path), ids=headIds(heads);
    if (index.conflicts.has(path) || JSON.stringify(ids)!==JSON.stringify(preview.headIds) ||
        heads[0].hash!==localHash || await digest(await local.read(path))!==localHash)
        throw Error("本地或远端文件已变化，请先同步，然后重新比较。");
    if (rev.hash===localHash) throw Error("此版本与当前文件相同。");
    const bytes=rev.hash===null ? null : await store.readBody(rev);
    if (!active() || await digest(await local.read(path))!==localHash) throw Error("文件已变化，请重新比较。");
    // Anchor the pre-restore bytes even on a freshly joined device. A lost response
    // can then be reconciled without reviving those bytes as an independent edit.
    baseline.set(path,{ids,hash:localHash}); checkpoint(baseline);
    const next=await store.publish(path,ids,bytes);
    if (!active()) throw Error("恢复版本已提交，请在重新同步后查看。");
    await local.apply(path,localHash,bytes);
    baseline.set(path,{ids:[next.id],hash:next.hash}); checkpoint(baseline);
    return next;
}
module.exports={periods,day,setPeriod,revisionIndex,snapshot,maintain,restore,headIds,digest};
