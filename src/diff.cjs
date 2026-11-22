"use strict";

// Preserve line terminators so an empty file, a blank line and a missing final
// newline compare differently. Trim matching ends before allocating the LCS table.
function lineDiff(before, after) {
    const lines = text => text.match(/[^\n]*\n|[^\n]+$/g) || [];
    const a = lines(before), b = lines(after), rows = [];
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
    }
    // A large changed block is shown as a replacement without quadratic work.
    while (i < endA) row("remove",a[i++]);
    while (j < endB) row("add",b[j++]);
    for (i = endA; i < a.length; i++) row("same",a[i]);
    return rows;
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
module.exports = {lineDiff, contextRows, textWindow};
