"use strict";
const qr = require("qrcode-generator");
const decodeQR = require("jsqr");
const core = require("./core.cjs");
const prefix = "HB-DAV2.";
const backupPrefix = "HB-KEY2.";

function backup(id, key) {
    if (typeof id !== "string" || typeof key !== "string" || !/^[0-9a-f]{32}$/.test(id) || !/^[0-9a-f]{64}$/.test(key)) throw Error("库标识或密钥无效。");
    return backupPrefix + id + "." + key;
}

function recover(text) {
    const match = /^HB-KEY2\.([0-9a-f]{32})\.([0-9a-f]{64})$/.exec(text.trim());
    if (!match) throw Error("请输入此库的完整恢复密钥。");
    return {id:match[1], key:match[2]};
}

function validate(fields) {
    if (!fields || fields.v !== 2 || typeof fields.folder !== "string" ||
        typeof fields.username !== "string" || !fields.username || fields.username.includes(":") ||
        typeof fields.password !== "string" || !fields.password) throw Error("无效的 Homebound 共享码。");
    const address = core.davAddress(fields.address), folder = core.directory(fields.folder);
    backup(fields.id, fields.key);
    return {v:2, address, folder, username:fields.username, password:fields.password, id:fields.id, key:fields.key};
}

function create(fields) {
    const bytes = new TextEncoder().encode(JSON.stringify(validate({...fields, v:2})));
    if (bytes.length > 1680) throw Error("配置过长，无法生成二维码。请用恢复密钥和 WebDAV 配置连接。");
    return prefix + btoa(String.fromCharCode(...bytes));
}

function parse(text) {
    if (typeof text !== "string" || !text.startsWith(prefix) || text.length > 2300) throw Error("请扫描 Homebound 个人库共享码。");
    try {
        const bytes = Uint8Array.from(atob(text.slice(prefix.length)), c => c.charCodeAt(0));
        return validate(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)));
    } catch { throw Error("共享码内容无效。"); }
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

function scanPixels(canvas, source, width, height) {
    const scale = Math.min(1, 1920 / Math.max(width,height));
    canvas.width = Math.max(1,Math.round(width*scale));
    canvas.height = Math.max(1,Math.round(height*scale));
    const ctx = canvas.getContext("2d",{willReadFrequently:true});
    ctx.drawImage(source,0,0,canvas.width,canvas.height);
    const pixels = ctx.getImageData(0,0,canvas.width,canvas.height);
    return decodeQR(pixels.data,pixels.width,pixels.height);
}

async function readPhoto(file) {
    const url = URL.createObjectURL(file);
    try {
        const img = new Image(); img.src = url; await img.decode();
        const result = scanPixels(document.createElement("canvas"), img, img.naturalWidth, img.naturalHeight);
        if (!result) throw Error("未识别到二维码，请拍清楚整个二维码或选择截图。");
        return parse(result.data);
    } finally { URL.revokeObjectURL(url); }
}
module.exports = {backup,recover,create,parse,draw,scanPixels,readPhoto};
