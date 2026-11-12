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
        return { contents, archived, baseline, local, async sync(resolve) {
            const result = await core.synchronize({ store, local, baseline, cache, checkpoint() {}, resolve });
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

test("key verifier rejects another vault, wrong passphrase, and tampering", async () => {
    const header = await core.newHeader("a long test phrase");
    await core.unlock(header, "a long test phrase", header.id);
    await assert.rejects(core.unlock(header, "wrong", header.id));
    await assert.rejects(core.unlock(header, "a long test phrase", core.randomId()));
    const altered = { ...header, proof: header.proof.slice(0, -1) + (header.proof.endsWith("a") ? "b" : "a") };
    await assert.rejects(core.unlock(altered, "a long test phrase", header.id));
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
    const setup = () => core.createVault(new Dav(""), "nested/中文", "a long test passphrase", "homebound-v1");
    await assert.rejects(setup(), /offline/);
    const header = await setup();
    assert.equal(core.parseBytes(files.get("/nested/中文/homebound-v1/vault.json")).id, header.id);
    await assert.rejects(setup(), /empty remote folder/);
});
