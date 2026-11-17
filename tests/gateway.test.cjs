"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const core = require("../src/core.cjs");

test("a gateway retains its base path and never defaults to a legacy LAN address", () => {
    const home = "https://192.168.0.1:24440", away = "https://gateway.example/personal";
    assert.equal(core.gatewayAddress({home, away}), away);
    assert.equal(core.gatewayAddress({home}), "");
    assert.equal(core.gatewayAddress({address: "", away}), "");
    assert.equal(core.gatewayUrl(away + "///"), away);
    for (const invalid of ["", "relative", "http://gateway.example", "https://user:pass@gateway.example"]) {
        assert.throws(() => core.gatewayUrl(invalid), /WebDAV 地址/);
    }
});

test("upgraded devices keep their identity and send DAV and ledger requests only through the gateway", async () => {
    const bundle = fs.readFileSync(require.resolve("../main.js"), "utf8");
    const home = "https://lan.invalid", away = "https://vps.example/my-vault";
    const witness = "https://vps.example/old-ledger", calls = [], saved = new Map();
    saved.set("homebound-webdav-mode", "pqc");
    saved.set("homebound-webdav-pqc-config", {format:2, home, away, witness, anchor:"a".repeat(32), local:"identity", username:"alice", name:"Mac"});
    const mod = {exports:{}};
    new Function("module","require",bundle)(mod, () => ({
        Plugin:class {}, PluginSettingTab:class {}, Modal:class {}, getLanguage:()=>"en",
        requestUrl:async req => {
            calls.push(req);
            if (req.method === "GET") throw Error("offline");
            return {status:200, json:{}};
        }
    }));
    const plugin = new mod.exports();
    plugin.manifest = {id:"homebound-webdav"};
    plugin.loadData = async () => ({home, away, id:"existing", secretId:"legacy-key"});
    plugin.app = {vault:{getName:()=>"test"},workspace:{onLayoutReady(){}}, loadLocalStorage:k=>saved.get(k),
        saveLocalStorage:(k,v)=>saved.set(k,v), secretStorage:{getSecret:()=>"dav-password", setSecret(){}}};
    plugin.addCommand = plugin.addSettingTab = plugin.registerDomEvent = plugin.registerInterval = () => {};
    const previous = {window:global.window, document:global.document};
    global.window = {setInterval:()=>0}; global.document = {};
    try {
        await plugin.onload();
        const q = plugin.pqc;
        assert.equal(plugin.config.address,away);
        assert.equal(q.config.local,"identity");
        await assert.rejects(q.route(), /unreachable/);
        assert.deepEqual(calls.map(x=>x.url), [away+"/Homebound-PQC/pqc-preview-2/vault.json"]);
        assert.match(calls[0].headers.Authorization,/^Basic /);
        await q.ledger("commit", {}, "write-capability");
        assert.equal(calls[1].url,witness+"/commit");
        assert.equal(calls[1].headers.Authorization,"Bearer write-capability");
        await assert.rejects(q.configure({...q.config,address:"https://another.example"}, ""), /已绑定/);
        assert.equal(calls.length,2);
        assert.equal(q.config.address,away);
        await q.configure(q.config,"");
        assert.equal(q.config.home,away);
        assert.equal(q.config.away,away);
        assert.equal(q.config.witness,witness);
    } finally {Object.assign(global,previous);}
});
