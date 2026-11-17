"use strict";
const qr = require("qrcode-generator");
const decodeQR = require("jsqr");
const core = require("./core.cjs");
const pq = require("./pqc.cjs");

const action = "homebound-join";
const shortId = /^[0-9a-f]{32}$/;

function validate(params, now = Date.now()) {
    const {v, address, anchor, slot, head, until, ledger} = params;
    if (!["1","2"].includes(v) || !shortId.test(anchor) || !shortId.test(slot) || !/^[0-9a-f]{64}$/.test(head))
        throw Error("无效的 Homebound 设备邀请。");
    const expires = Number(until);
    if (!Number.isSafeInteger(expires) || expires <= now || expires > now + pq.lifetime + 60000)
        throw Error("邀请已过期或设备时间不一致，请重新扫码。");
    const gateway = core.gatewayUrl(address);
    const service = ledger === undefined ? gateway + "/homebound-pqc-ledger" : core.gatewayUrl(ledger);
    if (new URL(service).origin !== new URL(gateway).origin) throw Error("邀请中的提交服务必须与网关同源。");
    return {address:gateway, ledger:service, anchor, slot, head, expires, automatic:v==="2"};
}

function create(address, ledger, snapshot) {
    const {p,digest} = pq.membershipHead(snapshot);
    const params = {v:snapshot.deviceDav?"2":"1", address, anchor:p.anchor, slot:core.randomId(), head:digest, until:String(Date.now()+pq.lifetime)};
    if (ledger !== address+"/homebound-pqc-ledger") params.ledger = ledger;
    const invite = validate(params);
    const url = "obsidian://"+action+"?"+new URLSearchParams(params);
    if (url.length > 1500) throw Error("网关地址过长，请使用手动配对。");
    return {...invite,url};
}

function parse(text) {
    if (typeof text !== "string" || text.length > 1500) throw Error("二维码格式无效。");
    const url = new URL(text);
    if (url.protocol !== "obsidian:" || url.host !== action || url.username || url.password || url.pathname || url.hash)
        throw Error("请扫描管理员显示的 Homebound 邀请码。");
    return validate(Object.fromEntries(url.searchParams));
}

function draw(canvas, text) {
    const code = qr(0,"M");
    code.addData(text); code.make();
    const quiet = 4, cell = 6, count = code.getModuleCount();
    canvas.width = canvas.height = (count + 2 * quiet) * cell;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white"; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = "black";
    for (let y=0;y<count;y++) for (let x=0;x<count;x++)
        if (code.isDark(y,x)) ctx.fillRect((x+quiet)*cell,(y+quiet)*cell,cell,cell);
}

async function readPhoto(file) {
    const url = URL.createObjectURL(file);
    try {
        const img = new Image(); img.src = url; await img.decode();
        const scale = Math.min(1, 1920 / Math.max(img.naturalWidth,img.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1,Math.round(img.naturalWidth*scale));
        canvas.height = Math.max(1,Math.round(img.naturalHeight*scale));
        const ctx = canvas.getContext("2d",{willReadFrequently:true});
        ctx.drawImage(img,0,0,canvas.width,canvas.height);
        const pixels = ctx.getImageData(0,0,canvas.width,canvas.height);
        const result = decodeQR(pixels.data,pixels.width,pixels.height);
        if (!result) throw Error("未识别到二维码，请拍清楚整个二维码或选择截图。");
        return parse(result.data);
    } finally { URL.revokeObjectURL(url); }
}
module.exports = {action,validate,create,parse,draw,readPhoto};
