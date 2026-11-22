"use strict";

// Preserve line terminators so an empty file, a blank line and a missing final
// newline compare differently. Trim matching ends before allocating the LCS table.
const lines = text => text.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) || [];
function lineDiff(before, after) {
    return sequenceDiff(lines(before),lines(after));
}

function sequenceDiff(a,b,depth=0) {
    const rows = [];
    const row = (kind, text) => rows.push({kind,text});
    let start = 0, endA = a.length, endB = b.length;
    while (start < endA && start < endB && a[start] === b[start]) row("same", a[start++]);
    while (endA > start && endB > start && a[endA-1] === b[endB-1]) { endA--; endB--; }
    const width = endB - start + 1, height = endA - start + 1;
    let i = start, j = start;
    if (width * height <= 300000) {
        const lcs = new Uint16Array(width * height);
        for (let x = endA-1; x >= start; x--) {
            for (let y = endB-1; y >= start; y--) {
                const n = (x-start)*width + y-start;
                lcs[n] = a[x] === b[y] ? 1 + lcs[n+width+1] : Math.max(lcs[n+1],lcs[n+width]);
            }
        }
        while (i < endA && j < endB) {
            const n = (i-start)*width + j-start;
            if (a[i] === b[j]) { row("same",a[i++]); j++; }
            else if (lcs[n+width] >= lcs[n+1]) row("remove",a[i++]);
            else row("add",b[j++]);
        }
    } else {
        const sparse = sparseDiff(a,start,endA,b,endB);
        if (sparse) {
            for (const change of sparse) rows.push(change);
            i=endA; j=endB;
        } else if (depth<12) {
            const anchor = sharedAnchor(a,b,start,endA,endB);
            if (anchor) {
                const [x,y] = anchor;
                for (const change of sequenceDiff(a.slice(start,x),b.slice(start,y),depth+1)) rows.push(change);
                row("same",a[x]);
                for (const change of sequenceDiff(a.slice(x+1,endA),b.slice(y+1,endB),depth+1)) rows.push(change);
                i=endA; j=endB;
            }
        }
    }
    // A large changed block is shown as a replacement without quadratic work.
    while (i < endA) row("remove",a[i++]);
    while (j < endB) row("add",b[j++]);
    for (i = endA; i < a.length; i++) row("same",a[i]);
    return rows;
}

// Long notes can have big insertions at both ends of an otherwise unchanged
// section. Split on an unambiguous shared token near the middle of both ranges.
function sharedAnchor(a,b,start,endA,endB) {
    function uniquePositions(tokens,end) {
        const positions=new Map();
        for (let i=start;i<end;i++) positions.set(tokens[i],positions.has(tokens[i]) ? -1 : i);
        return positions;
    }
    const left=uniquePositions(a,endA), right=uniquePositions(b,endB);
    let best=null, distance=Infinity;
    for (const [token,x] of left) {
        const y=right.get(token);
        if (x<0 || y===undefined || y<0) continue;
        const score=Math.max(Math.abs((x-start)/(endA-start)-0.5),Math.abs((y-start)/(endB-start)-0.5));
        if (score<distance) { best=[x,y]; distance=score; }
    }
    return best;
}

// Myers' edit frontier keeps separated small edits in long notes separated.
// Bound the trace on wholesale rewrites, which can be reviewed as one block.
function sparseDiff(a,start,endA,b,endB) {
    const n=endA-start, m=endB-start, limit=128;
    if (Math.abs(n-m)>limit) return null;
    const offset=limit+1, v=new Int32Array(2*limit+3), trace=[];
    for (let d=0;d<=limit;d++) {
        trace.push(v.slice());
        for (let k=-d;k<=d;k+=2) {
            const at=offset+k;
            let x=k===-d || (k!==d && v[at-1]<v[at+1]) ? v[at+1] : v[at-1]+1;
            let y=x-k;
            while (x<n && y<m && a[start+x]===b[start+y]) { x++; y++; }
            v[at]=x;
            if (x!==n || y!==m) continue;
            const reversed=[];
            for (let depth=d;depth>0;depth--) {
                const diag=x-y, prev=trace[depth];
                const down=diag===-depth || (diag!==depth && prev[offset+diag-1]<prev[offset+diag+1]);
                const prevDiag=diag+(down?1:-1), prevX=prev[offset+prevDiag], prevY=prevX-prevDiag;
                while (x>prevX && y>prevY) {
                    x--;
                    y--;
                    reversed.push({kind:"same",text:a[start+x]});
                }
                if (down) reversed.push({kind:"add",text:b[start+(--y)]});
                else reversed.push({kind:"remove",text:a[start+(--x)]});
            }
            while (x>0) reversed.push({kind:"same",text:a[start+(--x)]});
            return reversed.reverse();
        }
    }
    return null;
}

function contextRows(rows) {
    const result = [];
    for (let i = 0; i < rows.length;) {
        if (rows[i].kind !== "same") { result.push(rows[i++]); continue; }
        let end = i+1;
        while (end < rows.length && rows[end].kind === "same") end++;
        if (end-i > 7) {
            result.push(...rows.slice(i,i+3),{kind:"gap",count:end-i-6},...rows.slice(end-3,end));
        } else result.push(...rows.slice(i,end));
        i = end;
    }
    return result;
}

// Keep each large-file preview bounded. Prefer whole lines, and never cut a
// UTF-8 character when a single line is longer than the byte budget.
function textWindow(buffer, offset) {
    const bytes = new Uint8Array(buffer);
    const limit = Math.min(offset + 65536, bytes.length);
    let end = offset, lines = 0, lastBreak = offset;
    while (end < limit && lines < 160) {
        if (bytes[end++] === 10) { lines++; lastBreak = end; }
    }
    if (end < bytes.length && lastBreak > offset) end = lastBreak;
    else while (end > offset && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    // Malformed bytes must still advance to let the decoder report them.
    if (end === offset && limit > offset) end = limit;
    return {slice:bytes.subarray(offset,end), end};
}
module.exports = {lines, sequenceDiff, lineDiff, contextRows, textWindow};
