"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {sha,randomId,synchronize} = require("../src/core.cjs");
const {ConflictFiles,siblingPath} = require("../src/conflict-files.cjs");

class TFile {}
class TFolder {}
const compiled = {exports:{}};
new Function("module","require",fs.readFileSync(require.resolve("../main.js"),"utf8"))(compiled,()=>({
    Plugin:class {},PluginSettingTab:class {},Modal:class {},TFile,TFolder,getLanguage:()=>"en"
}));
const bytes = text => new TextEncoder().encode(text).buffer;
async function revision(name,body) { return {id:randomId(),path:name,hash:await sha(bytes(body))}; }

async function fixture(t) {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(),"homebound-copies-"));
    t.after(()=>fsp.rm(root,{recursive:true,force:true}));
    const full = p=>path.join(root,p);
    const disk = {
        exists:async p=>fs.existsSync(full(p)),mkdir:p=>fsp.mkdir(full(p)),
        write:(p,s)=>fsp.writeFile(full(p),s),read:p=>fsp.readFile(full(p),"utf8"),
        writeBinary:(p,b)=>fsp.writeFile(full(p),new Uint8Array(b)),readBinary:async p=>Uint8Array.from(await fsp.readFile(full(p))).buffer,
        rename:(a,b)=>fsp.rename(full(a),full(b)),remove:p=>fsp.unlink(full(p)),
        trashLocal:p=>fsp.rmdir(full(p)),
        async list(p) {
            const files=[],folders=[];
            for(const e of await fsp.readdir(full(p),{withFileTypes:true}))
                (e.isDirectory()?folders:files).push(p+"/"+e.name);
            return {files,folders};
        }
    };
    function item(p) {
        if(!fs.existsSync(full(p)))return null;
        const obj=fs.statSync(full(p)).isDirectory()?new TFolder():new TFile();
        obj.path=p;obj.parent={path:path.posix.dirname(p)};
        if(obj instanceof TFolder)obj.children=fs.readdirSync(full(p)).map(n=>item(p+"/"+n));
        return obj;
    }
    const vault={configDir:".config",adapter:disk,getAbstractFileByPath:item,
        readBinary:f=>disk.readBinary(f.path),createFolder:async p=>{await disk.mkdir(p);return item(p);},
        createBinary:async(p,b)=>{await fsp.writeFile(full(p),new Uint8Array(b),{flag:"wx"});return item(p);}};
    const app={vault,fileManager:{trashFile:f=>disk.remove(f.path)}};
    const plugin=new compiled.exports();
    plugin.app=app;
    const make=async()=>{
        plugin.copies=new ConflictFiles(app,".config/plugins/homebound-webdav");
        await plugin.copies.load();return plugin.copies;
    };
    const copies=await make();
    return {copies,reload:make,local:plugin.local(),disk,vault,plugin};
}

test("unresolved versions stay private, dismissal writes one local sibling and restart restores its exclusion",async t=>{
    const {copies,disk,local,vault,reload,plugin}=await fixture(t);
    const rev=await revision("folder/日记.md","remote"),hist=new Map([[rev.id,rev]]);
    await copies.archive(rev,()=>bytes("remote"));
    await copies.archive(rev,()=>assert.fail("unexpected duplicate read"));
    assert.equal(await disk.exists("folder"),false);
    assert.equal(await sha(await copies.read(rev)),rev.hash);
    const create=vault.createBinary;
    vault.createBinary=async(p,b)=>{assert.equal(plugin.local().allowed(p),false);return create(p,b);};
    await Promise.all([copies.defer(rev,local,hist),copies.defer(rev,local,hist)]);
    const [sibling]=copies.paths;
    assert.match(sibling,new RegExp("^folder/日记-[0-9]{14}-conflict-"+rev.id+"[.]md$"));
    assert.deepEqual((await disk.list("folder")).files,[sibling]);
    const again=await reload(),current=plugin.local();
    assert.equal(current.allowed(sibling),false);
    await disk.remove(sibling); // a deferred write can be interrupted after its ownership record
    await again.reconcile(current,hist,new Map([[rev.path,rev.id]]));
    assert.equal(await disk.read(sibling),"remote");
    assert.deepEqual(await again.clearHistory([rev.path],hist),{removed:0,edited:0});
    await again.reconcile(current,hist,new Map());
    assert.equal(await disk.exists(sibling),false);
    assert.equal(await disk.exists(again.archivePath(rev)),true);
    assert.deepEqual(await again.clearHistory([],hist),{removed:1,edited:0});
    assert.equal(await disk.exists(again.root),false);
    assert.deepEqual(await again.clearHistory([],hist),{removed:0,edited:0});
});

test("same-name notes, edited siblings and unrelated plugin files survive cleanup",async t=>{
    const {copies,disk,local}=await fixture(t);
    const rev=await revision("照片.png","binary"),hist=new Map([[rev.id,rev]]);
    await copies.archive(rev,()=>bytes("binary"));
    // Force the candidate to collide with a real, user-created note.
    const exists=disk.exists;let collision;
    disk.exists=async p=>{
        if(!collision && p.startsWith("照片-")){collision=p;await disk.write(p,"unrelated");}
        return exists(p);
    };
    await copies.defer(rev,local,hist);
    const [sibling]=copies.paths;
    assert.notEqual(sibling,collision);assert.equal(local.allowed(collision),true);
    assert.equal(await disk.read(sibling),"binary");
    await disk.write(sibling,"my edits");
    const settings=".config/plugins/homebound-webdav/data.json";
    await disk.write(settings,"settings");await disk.write(copies.root+"/other.md","keep");
    await copies.reconcile(local,hist,new Map());
    assert.deepEqual(await copies.clearHistory([],hist),{removed:1,edited:1});
    for(const [p,s] of [[collision,"unrelated"],[sibling,"my edits"],[settings,"settings"],[copies.root+"/other.md","keep"]])
        assert.equal(await disk.read(p),s);
});

test("upgrade moves validated legacy copies to private storage and preserves edited or unrecognized notes",async t=>{
    const {copies,disk,local}=await fixture(t);
    const rev=await revision("子目录/笔记.md","old"),edited=await revision("另.md","before");
    const hist=new Map([[rev.id,rev],[edited.id,edited]]);
    const legacy=r=>"Homebound conflicts/"+r.id+"/"+r.path;
    for(const [p,s] of [[legacy(rev),"old"],[legacy(edited),"after"],["Homebound conflicts/mine.md","personal"]]){
        await local.folders(p);await disk.write(p,s);
    }
    await copies.reconcile(local,hist,new Map());
    assert.equal(await disk.exists(legacy(rev)),false);assert.equal(await disk.exists("Homebound conflicts/"+rev.id),false);
    assert.equal(await disk.read(copies.archivePath(rev)),"old");
    assert.deepEqual(await copies.clearHistory([],hist),{removed:1,edited:1});
    assert.equal(await disk.read(legacy(edited)),"after");assert.equal(await disk.read("Homebound conflicts/mine.md"),"personal");
});

test("sibling names fit a filesystem component and retain the original extension",()=>{
    const name=siblingPath({path:"d/"+"画".repeat(75)+".canvas",id:"a".repeat(32),time:"20261123161159",number:0});
    assert(Buffer.byteLength(path.basename(name))<=255);
    assert.match(name,/^d\/画+-20261123161159-conflict-a{32}\.canvas$/);
});

test("a marker written after startup still excludes an edited sibling, including across a second sync",async t=>{
    const {copies,disk,local,vault,reload,plugin}=await fixture(t);
    const rev={...await revision("note.md","branch"),parents:[]};
    const history=new Map([[rev.id,rev]]);
    await disk.write(rev.path,"branch");
    await copies.archive(rev,()=>bytes("branch"));
    const next=await reload(); // Snapshot taken before the old instance finishes dismissing its modal.
    await copies.defer(rev,local,history);
    const [sibling]=copies.paths;
    assert(!next.paths.has(sibling));
    await disk.write(sibling,"edited private draft");
    vault.getFiles=()=>[rev.path,sibling].map(path=>({path}));
    const run=()=>synchronize({store:{history:async()=>history,publish:()=>assert.fail("uploaded local copy")},
        local:plugin.local(),baseline:new Map(),checkpoint(){}});
    assert.equal((await run()).sent,0);
    assert(next.paths.has(sibling));
    assert.equal((await run()).sent,0);
    assert.equal(await disk.read(sibling),"edited private draft");
});

test("an authenticated legacy copy is skipped on a peer without a marker; a similar real note still downloads",async t=>{
    const {copies,disk,local,vault}=await fixture(t);
    const rev={...await revision("note.md","branch"),parents:[]};
    const record={...rev,time:"20261123131005",number:0};
    const leak={...await revision(siblingPath(record),"branch"),parents:[]};
    const user={...await revision(siblingPath({...record,number:1}),"ordinary note"),parents:[]};
    const history=new Map([rev,leak,user].map(r=>[r.id,r]));
    await disk.write(rev.path,"branch");
    vault.getFiles=()=>[{path:rev.path}];
    const baseline=new Map([[leak.path,{ids:[leak.id],hash:leak.hash}]]);
    const result=await synchronize({store:{history:async()=>history,readBody:r=>{
        assert.equal(r.id,user.id);return bytes("ordinary note");
    }},local,baseline,checkpoint(){}});
    assert.equal(result.sent,0);
    assert.equal(result.received,1);
    assert(!baseline.has(leak.path));
    assert.equal(await disk.exists(leak.path),false);
    assert.equal(await disk.read(user.path),"ordinary note");
    assert(local.allowed(rev.path));
    assert.equal(copies.copies.size,0);
});

test("additional conflicting heads keep a single sibling and history cleanup protects only pending revisions",async t=>{
    const {copies,local,disk}=await fixture(t);
    const a=await revision("note.md","first"), b=await revision("note.md","second");
    const history=new Map([[a.id,a],[b.id,b]]),ids=[a.id,b.id];
    await copies.archive(a,()=>bytes("first"));await copies.archive(b,()=>bytes("second"));
    await copies.defer(a,local,history,ids);await copies.defer(b,local,history,ids);
    assert.equal(copies.paths.size,1);
    const active=new Map([[a.path,b.id]]);
    assert.deepEqual(await copies.clearHistory([a.path],history,active),{removed:2,edited:0});
    assert.equal(await disk.exists(copies.archivePath(a)),false);
    assert.equal(await disk.exists(copies.archivePath(b)),true);
});
