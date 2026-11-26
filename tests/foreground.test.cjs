"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {ForegroundStatus} = require("../src/foreground.cjs");

test("one four-state light follows the active pane and window without taking focus", () => {
    const frames=new Map(), events=new Map();
    let next=0;
    const win={navigator:{onLine:true},requestAnimationFrame:fn=>{frames.set(++next,fn);return next;},
        cancelAnimationFrame:id=>frames.delete(id)};
    const doc={defaultView:win,createElement:()=>new Element()};
    class Element {
        ownerDocument=doc; classList={add(){}}; dataset={}; attributes={}; textContent="";
        createSpan(options) { this.dot=options; }
        setAttribute(name,value) { this.attributes[name]=value; }
        getAttribute(name) { return this.attributes[name] ?? null; }
        append(child) { child.parentElement=this; }
        remove() { this.parentElement=null; }
    }
    let host=new Element();
    const plugin={state:{},conflicts:[],status:{},registerEvent(){},
        app:{workspace:{containerEl:{ownerDocument:doc},on:(name,fn)=>events.set(name,fn),
            getMostRecentLeaf:()=>host && ({view:{containerEl:host}})}}};
    const view=new ForegroundStatus(plugin,en=>en), el=view.el;
    function check(tone,label) {
        view.refresh();
        assert.equal(frames.size,1);
        const [id,paint]=frames.entries().next().value;
        frames.delete(id);paint();
        assert.equal(el.hidden,false);
        assert.equal(el.dataset.tone,tone);
        assert.equal(el.textContent,"");
        assert.equal(el.attributes.role,"img");
        assert.equal(el.attributes["aria-label"],"Homebound · "+label);
        assert.ok(!el.title);
    }
    assert.equal(el.hidden,true);
    assert.equal(el.dot.cls,"homebound-status-dot");
    assert.equal(el.parentElement,host);
    plugin.progress={phase:"versions",done:2,total:200};
    view.refresh();
    plugin.progress.done=123;
    check("active","Syncing");
    plugin.progress={phase:"files",done:3,total:8};
    plugin.transferBlock={direction:"upload",path:"private.pdf",done:7,total:25};
    check("active","Syncing");
    plugin.progress=null;
    plugin.transferBlock.direction="download";
    check("active","Syncing");
    plugin.transferBlock=null;
    plugin.state.pending={};check("issue","Needs attention");
    plugin.state.current={};check("issue","Needs attention");
    delete plugin.state.pending;
    check("waiting","Waiting to sync");
    plugin.status.lastSuccess=Date.now();check("idle","Synced");
    plugin.editTimer=1;check("waiting","Waiting to sync");
    plugin.editTimer=null;
    plugin.conflicts=["Note.md"];check("issue","Needs attention");
    plugin.conflicts=[];plugin.pollError="error";check("issue","Needs attention");
    plugin.pollError="";win.navigator.onLine=false;check("waiting","Waiting to sync");
    host=null; events.get("layout-change")();
    assert.equal(el.parentElement,null);
    host=new Element(); events.get("active-leaf-change")();
    assert.equal(el.parentElement,host);
    const popout=new Element();
    popout.ownerDocument={defaultView:{...win,navigator:{onLine:true}}};
    view.refresh();
    host=popout;events.get("file-open")();
    assert.equal(frames.size,0);
    assert.equal(el.parentElement,popout);
    assert.equal(el.dataset.tone,"idle");
    plugin.state.current=null;
    view.render();assert.equal(el.hidden,true);
    view.refresh();view.close();
    assert.equal(frames.size,0);
    assert.equal(el.parentElement,null);
});
