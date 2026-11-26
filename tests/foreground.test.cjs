"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {ForegroundStatus} = require("../src/foreground.cjs");

test("the mobile indicator follows the active view, coalesces progress, and clears completed transfers", () => {
    const frames = new Map(), events = new Map();
    let nextFrame = 0;
    const win = {navigator:{onLine:true},requestAnimationFrame:cb=>{frames.set(++nextFrame,cb);return nextFrame;},
        cancelAnimationFrame:id=>frames.delete(id)};
    const el = {classList:{add(){}}, dataset:{}, ownerDocument:{defaultView:win},
        createSpan:()=>({textContent:""}), remove(){this.parentElement=null;}};
    const host = () => ({append(child){child.parentElement=this;}});
    const first = host(), second = host();
    let current = first;
    const plugin = {state:{},conflicts:[],status:{},registerEvent(){},
        app:{workspace:{containerEl:{ownerDocument:{createElement:()=>el}},
            on:(name,fn)=>events.set(name,fn),getMostRecentLeaf:()=>({view:{containerEl:current}})}}};
    const view = new ForegroundStatus(plugin,true,()=>"en",en=>en);
    function paint() {
        view.refresh();
        assert.equal(frames.size,1);
        const [id,work] = frames.entries().next().value;
        frames.delete(id);work();
    }
    assert.equal(el.hidden,true);
    plugin.progress={phase:"connecting",total:null};
    paint();
    assert.equal(el.hidden,false);
    assert.match(view.label.textContent,/Verifying connection/);
    plugin.progress={phase:"versions",done:2,total:20};
    view.refresh();
    plugin.progress.done=7;
    paint();
    assert.equal(view.count.textContent,"7 / 20");

    current=second;events.get("active-leaf-change")();
    assert.equal(el.parentElement,second);
    plugin.progress={phase:"readback",done:2,total:5,block:{direction:"download",done:12,total:25}};
    paint();
    assert.equal(view.label.textContent,"Verifying blocks");
    assert.equal(view.count.textContent,"12 / 25");
    plugin.progress=null;
    plugin.state.pending={};
    paint();assert.equal(view.label.textContent,"Setup awaiting verification");
    plugin.state.current={};
    paint();assert.equal(view.label.textContent,"Key rotation awaiting verification");
    delete plugin.state.pending;
    plugin.status.lastSuccess=Date.now();
    paint();assert.match(view.label.textContent,/Last synced/);
    assert.equal(view.count.textContent,"");
    plugin.conflicts=["A","B"];paint();
    assert.equal(view.count.textContent,"2");
    plugin.pollError="test";paint();assert.equal(el.dataset.tone,"issue");
    assert.equal(view.label.textContent,"Sync needs attention");
    win.navigator.onLine=false;paint();assert.match(view.label.textContent,/Offline/);
    view.refresh();view.close();
    assert.equal(frames.size,0);
    assert.equal(el.parentElement,null);
});
