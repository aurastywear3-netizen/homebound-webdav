"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const jsQR = require("jsqr");
const sharing = require("../src/pairing-invite.cjs");
const core = require("../src/core.cjs");

test("draw and optically decode a personal QR with Unicode credentials and paths", () => {
    const fields = {v:2,address:"https://dav.example/base",folder:"笔记/100% 记录",username:"用户",
        password:"synthetic-測試-%&?#",id:core.randomId(),key:core.generateKey()};
    const payload = sharing.create({...fields,secretId:"local-only",otherVault:"unrelated"});
    let pixels;
    const canvas = {getContext() {
        pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4);
        return {fillRect(x,y,w,h) {
            const val = this.fillStyle === "black" ? 0 : 255;
            for (let row = y; row < y+h; row++) for (let col=x; col<x+w; col++) {
                const i = 4 * (row * canvas.width + col);
                pixels.fill(val,i,i+3); pixels[i+3] = 255;
            }
        }};
    }};
    sharing.draw(canvas,payload);
    const decoded = jsQR(pixels,canvas.width,canvas.height);
    assert.deepEqual(sharing.parse(decoded.data),fields);
    assert.deepEqual(sharing.recover(sharing.backup(fields.id,fields.key)),{id:fields.id,key:fields.key});
    for (const address of ["http://dav.example","https://user:pass@dav.example"])
        assert.throws(() => sharing.create({...fields,address}));
    assert.throws(() => sharing.parse("obsidian://homebound-join?x"));
    assert.throws(() => sharing.create({...fields,password:"a".repeat(3000)}));
    assert.throws(() => sharing.recover(fields.key));
});
