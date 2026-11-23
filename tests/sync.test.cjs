const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/core.cjs");
const text = str => new TextEncoder().encode(str).buffer;

async function fixture() {
    const files = new Map(), markers = new Set();
    const dav = { async read(path) { assert(files.has(path)); return files.get(path); },
        async put(path, data) { files.set(path, data); },
        async mkdir(path) { assert(!markers.has(path)); markers.add(path); },
        async list() { return [...markers].map(x => x.split("/")[1]); } };
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const store = new core.Store(dav, core.randomId(), key);
    function device() {
        const contents = new Map(), archived = new Map(), baseline = new Map();
        let cache = new Map();
        const local = {
            paths: () => new Set(contents.keys()), allowed: path => !core.isRecovery(path),
            read: async path => contents.get(path) ?? null,
            async apply(path, hash, bytes) {
                assert.equal(contents.has(path) ? await core.sha(contents.get(path)) : null, hash);
                if (bytes === null) contents.delete(path); else contents.set(path, bytes);
            },
            async archive(rev, body) { archived.set(rev.id, await body()); }
        };
        return { contents, archived, baseline, local, async sync(resolve, selection) {
            const result = await core.synchronize({ store, local, baseline, cache, checkpoint() {}, resolve, selection });
            cache = result.history;
            return result;
        } };
    }
    return { device, dav, store, files, markers };
}

test("Unicode folder input, literal percent signs and HTTPS rules", () => {
    assert.equal(core.directory(" /笔记/学习 100%/ "), "笔记/学习 100%");
    assert.equal(core.encodePath("英语/#100%"), "%E8%8B%B1%E8%AF%AD/%23100%25");
    for (const path of ["", "a/../b", ".obsidian/plugins", "foo//bar", "C:\\bad", "CON/note"]) {
        assert.throws(() => core.directory(path));
    }
    assert.throws(() => core.endpoint("http://dav.example.org"));
    assert.throws(() => core.endpoint("https://u:p@dav.example.org/test"));
});

test("an edit during first-download prefetch is preserved and other files still converge on retry", async () => {
    const {device,dav,store}=await fixture(), peer=device();
    const first=await store.publish("a.md",[],text("remote"));
    await store.publish("b.md",[],text("second"));
    const read=dav.read;
    dav.read=async name=>{
        if (name==="objects/b-"+first.id) peer.contents.set("a.md",text("offline edit"));
        return read(name);
    };
    await assert.rejects(peer.sync());
    assert.deepEqual(peer.contents.get("a.md"),text("offline edit"));
    assert(!peer.baseline.has("a.md"));
    dav.read=read;
    assert.deepEqual((await peer.sync()).conflicts,["a.md"]);
    assert.deepEqual(peer.contents.get("b.md"),text("second"));
});

test("key verifier rejects another vault, wrong random key, and tampering", async () => {
    const material = core.generateKey();
    const header = await core.newHeader(material, core.randomId());
    await core.unlock(header, material, header.id);
    await assert.rejects(core.unlock(header, core.generateKey(), header.id));
    await assert.rejects(core.unlock(header, material, core.randomId()));
    const altered = { ...header, proof: header.proof.slice(0, -1) + (header.proof.endsWith("a") ? "b" : "a") };
    await assert.rejects(core.unlock(altered, material, header.id));
});

test("two devices upload, restore, modify and propagate a deletion", async () => {
    const f = await fixture(), a = f.device(), b = f.device(), note = "私人/周记.md";
    const bytes = Uint8Array.from([0, 2, 255, 128, 0]).buffer;
    a.contents.set(note, text("a secret paragraph")); a.contents.set("附件.png", bytes);
    assert.equal((await a.sync()).sent, 2);
    assert.equal((await b.sync()).received, 2);
    assert.deepEqual(b.contents, a.contents);
    for (const [name, data] of f.files) {
        assert(!name.includes(note));
        assert(!Buffer.from(data).includes("a secret paragraph"));
        assert(!Buffer.from(data).includes(note));
    }
    b.contents.set(note, text("second edit")); b.contents.delete("附件.png"); await b.sync(); await a.sync();
    assert.deepEqual(a.contents, b.contents);
    assert.equal((await a.sync()).sent, 0);
});

test("a fresh listing rejects a removed verified revision before applying any local file", async () => {
    const f=await fixture(), peer=f.device();
    const rev=await f.store.publish("note.md",[],text("original"));
    const verified=await f.store.history(new Map());
    f.markers.delete("commits/"+rev.id);
    await assert.rejects(core.synchronize({store:f.store,cache:verified,baseline:peer.baseline,local:peer.local,
        checkpoint(){assert.fail("Unexpected checkpoint");}}),/Previously seen history is missing/);
    assert.equal(peer.contents.size,0);
});

test("a WebDAV that limits concurrent reads can finish the same listing without rereading successful revisions", async () => {
    const f=await fixture();
    for (let i=0;i<9;i++) await f.store.publish(i+".md",[],text("note"));
    const read=f.dav.read, completed=new Set();
    let busy=false, limited=0;
    f.dav.read=async path=>{
        if (busy) {limited++;throw Object.assign(Error("busy"),{status:429});}
        busy=true;
        try {
            await new Promise(setImmediate);
            assert(!completed.has(path));
            completed.add(path);
            return await read(path);
        } finally {busy=false;}
    };
    const history=await f.store.history(new Map());
    assert.equal(history.size,9);assert.equal(completed.size,9);assert.equal(limited,3);
});

test("simultaneous first uploads preserve both branches, export variants and resolve", async () => {
    const f = await fixture(), a = f.device(), b = f.device();
    const note = "weekly.md";
    a.contents.set(note, text("Alice")); b.contents.set(note, text("Bob"));
    await Promise.all([a.sync(), b.sync()]);
    assert.deepEqual((await a.sync()).conflicts, [note]);
    assert.deepEqual((await b.sync()).conflicts, [note]);
    assert.equal(a.archived.size, 2);
    a.contents.set(note, text("merged")); await a.sync(note); await b.sync();
    assert.deepEqual(a.contents, b.contents);
});

test("delete-versus-edit conflict retains the edit and pauses only this note", async () => {
    const f = await fixture(), a = f.device(), b = f.device();
    a.contents.set("note.md", text("base")); await a.sync(); await b.sync();
    a.contents.delete("note.md"); await a.sync();
    b.contents.set("note.md", text("keep this")); b.contents.set("other.md", text("other"));
    assert.deepEqual((await b.sync()).conflicts, ["note.md"]);
    assert.equal(b.archived.size, 1);
    assert.deepEqual(b.contents.get("note.md"), text("keep this"));
    await b.sync("note.md"); await a.sync(); assert.deepEqual(a.contents, b.contents);
});

test("interrupted publication is invisible and a retry succeeds", async () => {
    const f = await fixture(), a = f.device(), b = f.device();
    a.contents.set("note.md", text("draft"));
    const mkdir = f.dav.mkdir; f.dav.mkdir = async () => { throw Error("offline"); };
    await assert.rejects(a.sync(), /offline/);
    assert.equal((await b.sync()).received, 0);
    f.dav.mkdir = mkdir; await a.sync(); await b.sync();
    assert.deepEqual(a.contents, b.contents);
});

test("lost response after publication does not create an extra revision", async () => {
    const f = await fixture(), a = f.device();
    a.contents.set("note.md", text("draft"));
    const mkdir = f.dav.mkdir; f.dav.mkdir = async path => { await mkdir(path); throw Error("offline"); };
    await assert.rejects(a.sync(), /offline/);
    f.dav.mkdir = mkdir;
    assert.equal((await a.sync()).sent, 0); assert.equal(f.markers.size, 1);
});

test("missing history and altered ciphertext stop before replacing a local file", async () => {
    const f = await fixture(), a = f.device(), b = f.device();
    a.contents.set("note.md", text("first")); await a.sync(); await b.sync();
    a.contents.set("note.md", text("second")); await a.sync();
    const latest = [...f.markers].pop().split("/")[1];
    new Uint8Array(f.files.get("objects/b-" + latest))[15] ^= 1;
    await assert.rejects(b.sync()); assert.deepEqual(b.contents.get("note.md"), text("first"));
    f.markers.clear(); await assert.rejects(b.sync(), /history/);
});

test("case-insensitive path collision blocks writes", async () => {
    const f = await fixture(), a = f.device();
    a.contents.set("Notes/A.md", text("A")); a.contents.set("notes/b.md", text("B"));
    await assert.rejects(a.sync(), /collide/); assert.equal(f.markers.size, 0);
});

test("interrupted initialization and lost MOVE response are retriable; an existing vault is preserved", async () => {
    const dirs = new Set([""]), files = new Map();
    let failPut = true;
    class Dav {
        constructor(root) { this.root = root; }
        child(name) { return new Dav(this.root + "/" + name); }
        async mkdir(name) {
            const path = this.child(name).root;
            if (dirs.has(path)) throw Object.assign(Error("exists"), { status: 405 });
            dirs.add(path);
        }
        async list() {
            const prefix = this.root + "/";
            return [...dirs, ...files.keys()].filter(p => p.startsWith(prefix))
                .map(p => p.slice(prefix.length)).filter(p => !p.includes("/"));
        }
        async put(name, bytes) {
            if (failPut) { failPut = false; throw Error("offline"); }
            files.set(this.child(name).root, bytes);
        }
        async read(name) { return files.get(this.child(name).root); }
        async call(method, name, accepted, { headers }) {
            assert.equal(method, "MOVE"); assert.deepEqual(accepted, [201]); assert.equal(headers.Overwrite, "F");
            const from = this.child(name).root, to = headers.Destination;
            assert(!dirs.has(to));
            for (const path of [...dirs]) if (path === from || path.startsWith(from + "/")) {
                dirs.delete(path); dirs.add(to + path.slice(from.length));
            }
            for (const [path, data] of [...files]) if (path.startsWith(from + "/")) {
                files.delete(path); files.set(to + path.slice(from.length), data);
            }
            throw Error("lost response after MOVE");
        }
    }
    const material = core.generateKey(), id = core.randomId();
    const setup = (target = id) => core.createVault(new Dav(""), "nested/中文", material, target);
    await assert.rejects(setup(), /offline/);
    const header = await setup();
    assert.equal(core.parseBytes(files.get("/nested/中文/homebound-v2/vault.json")).id, header.id);
    assert.deepEqual(await setup(), header);
    await assert.rejects(setup(core.randomId()), /不匹配/);
});

async function offlineConflict() {
    const f = await fixture(), mac = f.device(), ipad = f.device(), note = "中文/冲突.md";
    mac.contents.set(note, text("base")); await mac.sync(); await ipad.sync();
    mac.contents.set(note, text("Mac")); ipad.contents.set(note, text("iPad"));
    await mac.sync(); await ipad.sync(); await mac.sync();
    const heads = core.headsByPath(await f.store.history(new Map())).get(note);
    const selection = {path:note, headIds:heads.map(r => r.id).sort(), localHash:await core.sha(text("Mac")),
        source:heads.find(r => r.hash !== mac.baseline.get(note).hash).id};
    return {f, mac, ipad, note, selection};
}

test("offline changes in different paragraphs auto-save one combined head and sync back without review",async()=>{
    const f=await fixture(),mac=f.device(),ipad=f.device(),note="日报.md";
    mac.contents.set(note,text("甲\n\n乙\n"));await mac.sync();await ipad.sync();
    mac.contents.set(note,text("Mac\n\n乙\n"));ipad.contents.set(note,text("甲\n\niPad\n"));
    await mac.sync();
    const merged=await ipad.sync();assert.deepEqual(merged.conflicts,[]);assert.equal(ipad.archived.size,0);
    const heads=core.headsByPath(merged.history).get(note);
    assert.equal(heads.length,1);assert.equal(heads[0].parents.length,2);
    assert.deepEqual(await f.store.readBody(heads[0]),text("Mac\n\niPad\n"));
    assert.deepEqual((await mac.sync()).conflicts,[]);assert.deepEqual(mac.contents,ipad.contents);
    assert.equal((await ipad.sync()).sent,0);assert.equal(f.markers.size,4);
});

test("a lost merge acknowledgement recovers without re-uploading the losing local branch",async()=>{
    const f=await fixture(),a=f.device(),b=f.device(),note="test.md";
    a.contents.set(note,text("a\nb\n"));await a.sync();await b.sync();
    b.contents.set(note,text("a\nB\n"));a.contents.set(note,text("A\nb\n"));await a.sync();
    const mkdir=f.dav.mkdir;let count=0;
    f.dav.mkdir=async path=>{await mkdir(path);if (++count===2) throw Error("merge acknowledgement lost");};
    await assert.rejects(b.sync(),/acknowledgement/);assert.deepEqual(b.contents.get(note),text("a\nB\n"));
    f.dav.mkdir=mkdir;const retry=await b.sync();assert.equal(retry.sent,0);assert.deepEqual(retry.conflicts,[]);
    await a.sync();assert.deepEqual(b.contents.get(note),text("A\nB\n"));assert.deepEqual(a.contents,b.contents);
});

test("editing the note while the automatic merge loads the base preserves the new edit",async()=>{
    const f=await fixture(),a=f.device(),b=f.device(),note="test.md";
    a.contents.set(note,text("a\nb\nc\n"));await a.sync();await b.sync();
    const [root]=b.baseline.get(note).ids;
    a.contents.set(note,text("A\nb\nc\n"));b.contents.set(note,text("a\nB\nc\n"));await a.sync();
    const read=f.store.readBody.bind(f.store);
    f.store.readBody=async rev=>{
        if (rev.id===root) b.contents.set(note,text("a\nB\nC\n"));
        return read(rev);
    };
    await assert.rejects(b.sync(),/正文已变化/);
    assert.deepEqual(b.contents.get(note),text("a\nB\nC\n"));
    f.store.readBody=read;
    assert.deepEqual((await b.sync()).conflicts,[]);await a.sync();
    assert.deepEqual(a.contents.get(note),text("A\nB\nC\n"));
});

test("an empty device and concurrent resolvers use the same branch contents and converge",async()=>{
    const f=await fixture(),old=f.device(),fresh=f.device(),note="test.md";
    old.contents.set(note,text("x\ny\n"));await old.sync();const parent=old.baseline.get(note).ids;
    await f.store.publish(note,parent,text("X\ny\n"));await f.store.publish(note,parent,text("x\nY\n"));
    const rounds=await Promise.all([fresh.sync(),old.sync()]);assert(rounds.every(r=>!r.conflicts.length));
    assert.deepEqual(fresh.contents.get(note),text("X\nY\n"));assert.deepEqual(old.contents,fresh.contents);
    for (const device of [old,fresh]) assert.equal((await device.sync()).sent,0);
});

test("an unpublished local change survives discovering two remote branches",async()=>{
    const f=await fixture(),d=f.device(),note="three.md";
    d.contents.set(note,text("a\nb\nc"));await d.sync();const parent=d.baseline.get(note).ids;
    await f.store.publish(note,parent,text("A\nb\nc"));await f.store.publish(note,parent,text("a\nB\nc"));
    d.contents.set(note,text("a\nb\nC"));const result=await d.sync();
    assert.deepEqual(result.conflicts,[]);assert.deepEqual(d.contents.get(note),text("A\nB\nC"));
    assert.equal(core.headsByPath(result.history).get(note).length,1);
});

test("binary attachments with disjoint byte changes stay in manual review",async()=>{
    const f=await fixture(),a=f.device(),b=f.device(),note="attachment.bin";
    a.contents.set(note,text("left\nright"));await a.sync();await b.sync();
    a.contents.set(note,text("LEFT\nright"));b.contents.set(note,text("left\nRIGHT"));await a.sync();
    assert.deepEqual((await b.sync()).conflicts,[note]);assert.equal(b.archived.size,2);
});

test("select a reviewed peer copy and converge without reporting the old conflict again", async () => {
    const {mac, ipad, note, selection} = await offlineConflict();
    const result = await mac.sync(undefined, selection);
    assert.equal(result.sent, 1); assert.deepEqual(result.conflicts, []);
    await ipad.sync();
    assert.deepEqual(mac.contents.get(note), text("iPad"));
    assert.deepEqual(ipad.contents, mac.contents);
    for (const device of [mac, ipad]) {
        const again = await device.sync();
        assert.deepEqual([again.sent, again.received, again.conflicts], [0,0,[]]);
    }
});

test("keep the resolver's version without a losing peer re-uploading its offline edit", async () => {
    const {mac, ipad, note, selection} = await offlineConflict();
    await mac.sync(undefined, {...selection, source:"local"}); await ipad.sync();
    assert.deepEqual(ipad.contents.get(note), text("Mac"));
    assert.deepEqual((await mac.sync()).conflicts, []);
});

test("an edited text merge publishes one revision with all reviewed parents; stale drafts cannot overwrite edits", async () => {
    const {mac, ipad, note, selection, f} = await offlineConflict();
    const merged = {...selection, source:"merge", peerId:selection.source, text:"Mac\r\niPad\r\n补充 😊\r\n"};
    mac.contents.set(note,text("another edit"));
    await assert.rejects(mac.sync(undefined,merged),/已变化/);
    assert.deepEqual(mac.contents.get(note),text("another edit"));
    mac.contents.set(note,text("Mac"));
    const result = await mac.sync(undefined,merged);
    assert.deepEqual(result.conflicts,[]);
    const [head] = core.headsByPath(await f.store.history(new Map())).get(note);
    assert.deepEqual(head.parents.sort(),selection.headIds);
    assert.deepEqual(await f.store.readBody(head),text(merged.text));
    await ipad.sync();
    assert.deepEqual(ipad.contents.get(note),mac.contents.get(note));
    assert.equal((await ipad.sync()).sent,0);
});

test("a stale comparison cannot replace a newer edit or resolve a different set of heads", async () => {
    const {mac, f, note, selection} = await offlineConflict();
    mac.contents.set(note, text("unsaved in comparison"));
    await assert.rejects(mac.sync(undefined, selection), /已变化/);
    assert.deepEqual(mac.contents.get(note), text("unsaved in comparison"));
    mac.contents.set(note, text("Mac"));
    await f.store.publish(note, [], text("offline third device"));
    await assert.rejects(mac.sync(undefined, selection), /已变化/);
    assert.equal(core.headsByPath(await f.store.history(new Map())).get(note).length, 3);
});

test("an interrupted merge leaves the original local file and both remote versions available for retry", async () => {
    const {mac, ipad, f, note, selection} = await offlineConflict();
    const draft = {...selection, source:"merge", peerId:selection.source, text:"Mac and iPad"};
    const mkdir = f.dav.mkdir;
    f.dav.mkdir = async () => { throw Error("offline before commit"); };
    await assert.rejects(mac.sync(undefined,draft),/offline before commit/);
    assert.deepEqual(mac.contents.get(note),text("Mac"));
    const heads = core.headsByPath(await f.store.history(new Map())).get(note);
    assert.deepEqual(heads.map(r=>r.id).sort(),selection.headIds);
    f.dav.mkdir = mkdir;
    await mac.sync(undefined,draft); await ipad.sync();
    assert.deepEqual(ipad.contents.get(note),text(draft.text));
});

test("merging two copies keeps a third independent version pending until the next comparison", async () => {
    const {mac, ipad, f, note, selection} = await offlineConflict();
    const third = await f.store.publish(note,[],text("third device"));
    const first = {...selection, headIds:[...selection.headIds,third.id].sort(),
        source:"merge", peerId:selection.source, text:"Mac and iPad"};
    const result = await mac.sync(undefined,first);
    assert.deepEqual(result.conflicts,[note]);
    const heads = core.headsByPath(result.history).get(note);
    assert.equal(heads.length,2);
    assert.deepEqual(heads.find(r=>r.id!==third.id).parents.sort(),selection.headIds);
    assert.deepEqual(mac.contents.get(note),text(first.text));
    const next = {...first, headIds:heads.map(r=>r.id).sort(), peerId:third.id,
        localHash:await core.sha(text(first.text)), text:"all three edits"};
    assert.deepEqual((await mac.sync(undefined,next)).conflicts,[]);
    await ipad.sync();
    assert.deepEqual(ipad.contents.get(note),text(next.text));
});

test("a selected deletion supersedes all reviewed conflict heads", async () => {
    const {mac, ipad, f, note, selection} = await offlineConflict();
    const deleted = await f.store.publish(note, [selection.source], null);
    await mac.sync();
    const heads = core.headsByPath(await f.store.history(new Map())).get(note);
    await mac.sync(undefined, {...selection, headIds:heads.map(r => r.id).sort(), source:deleted.id});
    assert.equal(mac.contents.has(note), false);
});
