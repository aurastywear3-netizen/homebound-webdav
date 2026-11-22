"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {threeWay,commonBase} = require("../src/merge.cjs");
const {sequenceDiff} = require("../src/diff.cjs");

function clean(base,left,right,expected) {
    for (const variants of [[left,right],[right,left]]) {
        const parts=threeWay(base,...variants);
        assert(parts.every(p=>typeof p==="string"));
        assert.equal(parts.join(""),expected);
    }
}

test("separate edits merge symmetrically, including adjacent lines and insertions at boundaries",()=>{
    clean("一\n二\n三","甲\n二\n三","一\n乙\n三","甲\n乙\n三");
    clean("一\n二\n","一\n增\n二\n","一\n改\n","一\n增\n改\n");
    clean("一\n二\n","一\n二\n三\n","一\n","一\n三\n");
    clean("a\nb\nc\nd\n","c\nd\n","a\nd\n","d\n");
    clean("\uFEFF一\r\n\r\n尾","\uFEFF首\r\n\r\n尾","\uFEFF一\r\n\r\n末","\uFEFF首\r\n\r\n末");
    clean("from 上海 to 北京","from 广州 to 北京","from 上海 to 杭州","from 广州 to 杭州");
    clean("a\nb","a\nB","a\nb\n","a\nB\n");
    clean("","同一段\n","同一段\n","同一段\n");
});

test("only the incompatible passage needs a decision, all choices retain unilateral edits",()=>{
    const parts=threeWay("上\n旧\n下\n","本机上\n甲\n下\n","上\n乙\n远端下\n");
    assert.deepEqual(parts.filter(p=>typeof p!=="string"),[{line:2,local:"甲",remote:"乙",context:"旧\n"}]);
    for (const choice of ["local","remote","edited"]) {
        const picked=parts.map(p=>typeof p==="string"?p:choice==="edited"?"手动":p[choice]).join("");
        assert.equal(picked,"本机上\n"+{local:"甲\n",remote:"乙\n",edited:"手动\n"}[choice]+"远端下\n");
    }
    const insert=threeWay("a\nz\n","a\nleft\nz\n","a\nright\nz\n");
    assert.deepEqual(insert,["a\n",{line:2,local:"left\n",remote:"right\n"},"z\n"]);
    const deletion=threeWay("a\nb\nc\n","a\nc\n","a\nR\nc\n");
    assert.deepEqual(deletion,["a\n",{line:2,local:"",remote:"R\n"},"c\n"]);
    const quantity=threeWay("量 10\n","量 20\n","量 11\n");
    assert.deepEqual(quantity.filter(p=>typeof p!=="string"),[{line:1,local:"20",remote:"11",context:"量 10\n"}]);
    const mixed=threeWay("one / same / end\n","ONE / local / end\n","one / remote / END\n");
    assert.equal(mixed.map(p=>typeof p==="string"?p:p.remote).join(""),"ONE / remote / END\n");
    const removed=threeWay("a\nb\nc\n","c\n","a\nB\nc\n");
    assert.equal(removed.map(p=>typeof p==="string"?p:p.remote).join(""),"B\nc\n");
    const inside=threeWay("a\nb\nc\n","c\n","a\nnew\nb\nc\n");
    assert(inside.some(p=>typeof p!=="string" && p.remote.includes("new\n")));
});

test("sparse edits far apart in a long note preserve intervening remote edits",()=>{
    const base=Array.from({length:9000},(_,i)=>"段 "+i+"\n");
    const left=base.slice(),right=base.slice(),expected=base.slice();
    for (const i of [1,3000,8200]) left[i]=expected[i]="local "+i+"\n";
    for (const i of [4,5900,8300]) right[i]=expected[i]="remote "+i+"\n";
    clean(base.join(""),left.join(""),right.join(""),expected.join(""));
    right.splice(8100,4);right.splice(8,0,"插入\n");
    const delta=sequenceDiff(base,right);
    assert.deepEqual(delta.filter(r=>r.kind!=="add").map(r=>r.text),base);
    assert.deepEqual(delta.filter(r=>r.kind!=="remove").map(r=>r.text),right);
    const bulk=base.slice(), target=base.slice();
    const extra=Array.from({length:160},()=>"+\n");
    target[4400]="peer inside unchanged section\n";
    const other=target.join("");
    for (const variant of [bulk,target]) {
        variant.splice(8000,0,...extra);
        variant.splice(100,0,...extra);
    }
    clean(base.join(""),bulk.join(""),other,target.join(""));
});

test("chooses latest shared history, declines ambiguous bases and independent creations",()=>{
    const h=new Map();
    const add=(id,...parents)=>{const rev={id,hash:id,parents};h.set(id,rev);return rev;};
    add("root");const a=add("a","root"),b=add("b","root");
    const c=add("c","a","b"),d=add("d","b","a"),e=add("e","c"),f=add("f","c");
    assert.equal(commonBase(h,[e,f]),c);assert.equal(commonBase(h,[c,d]),null);
    b.hash=a.hash;assert.equal(commonBase(h,[c,d]).hash,a.hash);
    assert.equal(commonBase(h,[a,add("unrelated")]),null);
});
