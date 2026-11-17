"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const invites=require("../src/pairing-invite.cjs");

test("invitation preserves the vault base path and discloses only public rendezvous details",()=>{
    const gateway="https://dav.example/my-vault";
    const snapshot={policies:[{p:{anchor:"a".repeat(32)},digest:"b".repeat(64)}]};
    const invite=invites.create(gateway,gateway+"/homebound-pqc-ledger",snapshot);
    const url=new URL(invite.url);
    assert.deepEqual([...url.searchParams.keys()].sort(),["address","anchor","head","slot","until","v"]);
    assert.equal(invites.parse(invite.url).address,gateway);
    url.searchParams.set("ledger","https://other.example/ledger");
    assert.throws(()=>invites.parse(url.href),/同源/);
    url.searchParams.delete("ledger");url.searchParams.set("until",String(Date.now()-1));
    assert.throws(()=>invites.parse(url.href),/过期/);
    assert.throws(()=>invites.parse("https://untrusted.example/"),/管理员/);
});
