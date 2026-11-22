"use strict";

const {lines,sequenceDiff}=require("./diff.cjs");

const isNote = path => /\.(md|txt)$/i.test(path);
// Avoid manufacturing a new word or number from two edits to the same token.
const words = text => text.match(/[\p{L}\p{M}\p{N}_]+(?:[.'’][\p{L}\p{M}\p{N}_]+)*|\r\n|[\s\S]/gu) || [];
function asText(bytes) {
    if (bytes === null) return null;
    try {
        const text = new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);
        return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) ? null : text;
    } catch { return null; }
}

// Use the latest common ancestor by ancestry, not by timestamp or commit ID.
// Criss-cross merges can have multiple incomparable bases with different text.
function commonBase(history, heads) {
    let common;
    for (const head of heads) {
        const reachable=new Set(), pending=[head.id];
        while (pending.length) {
            const id=pending.pop();
            if (reachable.has(id)) continue;
            reachable.add(id);
            for (const parent of history.get(id).parents) pending.push(parent);
        }
        if (!common) common=reachable;
        else for (const id of common) if (!reachable.has(id)) common.delete(id);
        if (!common.size) return null;
    }
    const latest=new Set(common);
    for (const id of common) for (const parent of history.get(id).parents) latest.delete(parent);
    const candidates=Array.from(latest,id=>history.get(id));
    return candidates.length && candidates.every(r=>r.hash===candidates[0].hash) ? candidates[0] : null;
}

function changes(base,variant,side,byLine) {
    const edits=[];
    let at=0, edit=null;
    function finish() {
        if (!edit) return;
        // Two adjacent changed lines can each have a different author on the other side.
        const count=edit.end-edit.start;
        if (byLine && count>1 && count===edit.add.length) {
            for (let i=0;i<count;i++) edits.push({side,start:edit.start+i,end:edit.start+i+1,add:[edit.add[i]]});
        } else edits.push(edit);
        edit=null;
    }
    for (const row of sequenceDiff(base,variant)) {
        if (row.kind==="same") { finish(); at++; continue; }
        if (!edit) edit={side,start:at,end:at,add:[]};
        if (row.kind==="remove") edit.end=++at;
        else edit.add.push(row.text);
    }
    finish();
    return edits;
}

function renderSide(base,start,end,edits) {
    let at=start, text="";
    for (const edit of edits) {
        text+=base.slice(at,edit.start).join("")+edit.add.join("");
        at=edit.end;
    }
    return text+base.slice(at,end).join("");
}

// Fixed pieces are strings. Only unresolved regions contain two alternatives.
function mergeUnits(base,left,right,byLine) {
    const ranges=[...changes(base,left,"local",byLine),...changes(base,right,"remote",byLine)];
    const insertedAt=new Set(ranges.filter(e=>e.start===e.end).map(e=>e.start));
    const edits=[];
    for (const edit of ranges) {
        if (!byLine || edit.add.length || edit.end-edit.start<2) {
            edits.push(edit);
            continue;
        }
        // A deletion of several lines only contests the lines the peer edited.
        // A peer insertion inside the deleted range still needs a decision.
        let start=edit.start;
        for (let end=start+1;end<=edit.end;end++) {
            if (end<edit.end && insertedAt.has(end)) continue;
            edits.push({...edit,start,end});
            start=end;
        }
    }
    edits.sort((a,b)=>a.start-b.start || a.end-b.end);
    const parts=[];
    let cursor=0, i=0;
    while (i<edits.length) {
        const first=edits[i++], start=first.start, group=[first];
        let end=first.end;
        // Touching edits compose in document order. Insertions at the very
        // same boundary overlap each other, but not an edit to the following line.
        while (i<edits.length && (edits[i].start<end ||
            (start===end && edits[i].start===start && edits[i].end===start))) {
            const edit=edits[i++]; group.push(edit); end=Math.max(end,edit.end);
        }
        if (cursor<start) parts.push(base.slice(cursor,start).join(""));
        const local=group.filter(e=>e.side==="local"), remote=group.filter(e=>e.side==="remote");
        const a=renderSide(base,start,end,local), b=renderSide(base,start,end,remote);
        const original=base.slice(start,end).join("");
        if (!remote.length || a===b || b===original) parts.push(a);
        else if (!local.length || a===original) parts.push(b);
        else if (group.every(edit=>!edit.add.length)) parts.push("");
        else {
            // Preserve unilateral word edits even when a different word on the
            // same line is contested. Show the original line for context.
            if (byLine && end===start+1 && lines(a).length===1 && lines(b).length===1) {
                const refined=mergeUnits(words(base[start]),words(a),words(b),false);
                for (const part of refined) {
                    parts.push(typeof part==="string" ? part : {...part,line:start+1,context:base[start]});
                }
            } else parts.push({local:a,remote:b,line:start+1});
        }
        cursor=end;
    }
    if (cursor<base.length) parts.push(base.slice(cursor).join(""));
    return parts;
}

function threeWay(base,local,remote) {
    if (local===remote || remote===base) return [local];
    if (local===base) return [remote];
    return mergeUnits(lines(base),lines(local),lines(remote),true);
}

async function notePlan(history,heads,leftHash,rightHash,local,remote,readBody) {
    if (local===null || remote===null || !heads.some(r=>r.hash===leftHash)) return null;
    const base=commonBase(history,heads.filter(r=>r.hash===leftHash || r.hash===rightHash));
    if (!base || base.hash===null) return null;
    const original=base.hash===leftHash ? local : base.hash===rightHash ? remote : asText(await readBody(base));
    return original===null ? null : threeWay(original,local,remote);
}

module.exports={isNote,asText,commonBase,threeWay,notePlan};
