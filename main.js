/*!
@noble/post-quantum
The MIT License (MIT)

Copyright (c) 2024 Paul Miller (https://paulmillr.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the “Software”), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
@noble/hashes
The MIT License (MIT)

Copyright (c) 2022 Paul Miller (https://paulmillr.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the “Software”), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
@noble/curves
The MIT License (MIT)

Copyright (c) 2022 Paul Miller (https://paulmillr.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the “Software”), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
@noble/ciphers
The MIT License (MIT)

Copyright (c) 2022 Paul Miller (https://paulmillr.com)
Copyright (c) 2016 Thomas Pornin <pornin@bolet.org>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the “Software”), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/core.cjs
var require_core = __commonJS({
  "src/core.cjs"(exports2, module2) {
    "use strict";
    var encoder = new TextEncoder();
    var decoder = new TextDecoder("utf-8", { fatal: true });
    var conflictFolder = "Homebound conflicts";
    var idPattern = /^[0-9a-f]{32}$/;
    var hashPattern = /^[0-9a-f]{64}$/;
    var hex = (bytes) => Array.from(new Uint8Array(bytes), (n) => n.toString(16).padStart(2, "0")).join("");
    var randomId = () => hex(crypto.getRandomValues(new Uint8Array(16)));
    var sha = async (data) => hex(await crypto.subtle.digest("SHA-256", data));
    var jsonBytes = (value) => encoder.encode(JSON.stringify(value));
    var parseBytes = (bytes) => JSON.parse(decoder.decode(bytes));
    function safePath(path) {
      if (typeof path !== "string" || path.length === 0) return false;
      return path.split("/").every((part) => part && !part.startsWith(".") && !/[\\:*?"<>|\u0000-\u001f\u007f]/.test(part) && !/[ .]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part));
    }
    function directory(input) {
      const path = input.trim().replace(/^\/+|\/+$/g, "").normalize("NFC");
      if (!safePath(path)) throw Error("Enter a folder such as Notes/\u6211\u7684\u7B14\u8BB0. Use / between folder names.");
      return path;
    }
    function endpoint(input) {
      const url = new URL(input.trim());
      const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      if (url.protocol !== "https:" && !(loopback && url.protocol === "http:") || url.username || url.password || url.search || url.hash) {
        throw Error("Use an HTTPS WebDAV address without credentials, a query, or a fragment.");
      }
      return url.href.replace(/\/+$/, "");
    }
    var encodePath = (path) => path.split("/").map(encodeURIComponent).join("/");
    var isRecovery = (path) => path.split("/")[0].toLowerCase() === conflictFolder.toLowerCase();
    async function derive(passphrase, salt) {
      const material = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
      const bytes = Uint8Array.from(salt.match(/../g), (pair) => parseInt(pair, 16));
      return crypto.subtle.deriveKey(
        { name: "PBKDF2", hash: "SHA-256", salt: bytes, iterations: 6e5 },
        material,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
      );
    }
    async function seal(key, label, data) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(label) }, key, data);
      const result = new Uint8Array(12 + cipher.byteLength);
      result.set(iv);
      result.set(new Uint8Array(cipher), 12);
      return result.buffer;
    }
    async function unseal(key, label, data) {
      const bytes = new Uint8Array(data);
      return crypto.subtle.decrypt(
        { name: "AES-GCM", iv: bytes.subarray(0, 12), additionalData: encoder.encode(label) },
        key,
        bytes.subarray(12)
      );
    }
    async function newHeader(passphrase) {
      const id2 = randomId();
      const salt = randomId();
      const key = await derive(passphrase, salt);
      const proof = hex(await seal(key, "homebound:1:" + id2, encoder.encode("vault")));
      return { format: 1, id: id2, salt, proof };
    }
    async function unlock(header, passphrase, pinned) {
      if (header?.format !== 1 || !idPattern.test(header.id) || !idPattern.test(header.salt) || !/^[0-9a-f]{66}$/.test(header.proof)) throw Error("Unrecognized WebDAV vault header.");
      if (pinned && pinned !== header.id) throw Error("This address leads to a different vault. Check both routes.");
      const key = await derive(passphrase, header.salt);
      try {
        const proof = Uint8Array.from(header.proof.match(/../g), (pair) => parseInt(pair, 16));
        if (decoder.decode(await unseal(key, "homebound:1:" + header.id, proof)) !== "vault") throw Error();
      } catch {
        throw Error("Vault passphrase or authenticated header is incorrect.");
      }
      return key;
    }
    var Store = class {
      constructor(dav, id2, key) {
        this.dav = dav;
        this.id = id2;
        this.key = key;
      }
      async readObject(name) {
        return unseal(this.key, this.id + "/" + name, await this.dav.read("objects/" + name));
      }
      async writeObject(name, bytes) {
        await this.dav.put("objects/" + name, await seal(this.key, this.id + "/" + name, bytes));
      }
      async publish(path, parents, bytes) {
        const id2 = randomId();
        const hash = bytes === null ? null : await sha(bytes);
        if (bytes !== null) await this.writeObject("b-" + id2, bytes);
        const rev = { id: id2, path, parents, hash };
        await this.writeObject("r-" + id2, jsonBytes(rev));
        await this.dav.mkdir("commits/" + id2);
        return rev;
      }
      async readBody(rev) {
        const bytes = await this.readObject("b-" + rev.id);
        if (await sha(bytes) !== rev.hash) throw Error("File integrity check failed: " + rev.path);
        return bytes;
      }
      async history(cache) {
        const names = await this.dav.list("commits");
        const visible = new Set(names);
        for (const id2 of cache.keys()) {
          if (!visible.has(id2)) throw Error("Previously seen history is missing from this server.");
        }
        const history = /* @__PURE__ */ new Map();
        for (const id2 of visible) {
          if (!idPattern.test(id2)) throw Error("Unexpected entry in the vault history.");
          const rev = cache.get(id2) ?? parseBytes(await this.readObject("r-" + id2));
          if (rev.id !== id2 || !safePath(rev.path) || isRecovery(rev.path) || !Array.isArray(rev.parents) || !rev.parents.every((p) => idPattern.test(p)) || !(rev.hash === null || hashPattern.test(rev.hash))) throw Error("Invalid revision metadata.");
          history.set(id2, rev);
        }
        return history;
      }
    };
    function headsByPath(history) {
      const parents = /* @__PURE__ */ new Set();
      const groups = /* @__PURE__ */ new Map();
      for (const rev of history.values()) {
        for (const parent of rev.parents) {
          if (history.get(parent)?.path !== rev.path || parent === rev.id) throw Error("Incomplete revision history.");
          parents.add(parent);
        }
      }
      for (const rev of history.values()) {
        if (parents.has(rev.id)) continue;
        if (!groups.has(rev.path)) groups.set(rev.path, []);
        groups.get(rev.path).push(rev);
      }
      return groups;
    }
    function checkAliases(paths) {
      const names = /* @__PURE__ */ new Map();
      const files = new Set(paths);
      for (const path of files) {
        const parts = path.split("/");
        for (let n = 1; n <= parts.length; n++) {
          const name = parts.slice(0, n).join("/");
          const key = name.normalize("NFC").toLowerCase();
          if (names.has(key) && names.get(key) !== name || n < parts.length && files.has(name)) {
            throw Error("File or folder names collide on this device: " + name);
          }
          names.set(key, name);
        }
      }
    }
    async function synchronize({ store, local, baseline, cache, checkpoint, resolve, active = () => true }) {
      const history = await store.history(cache);
      const groups = headsByPath(history);
      const localPaths = local.paths();
      for (const [path, base] of baseline) {
        if (!local.allowed(path) || !base.ids.length || base.ids.some((id2) => history.get(id2)?.path !== path || history.get(id2).hash !== base.hash)) {
          throw Error("Local checkpoint does not match the remote history. Sync stopped.");
        }
      }
      const paths = /* @__PURE__ */ new Set([...groups.keys(), ...localPaths, ...baseline.keys()]);
      for (const path of paths) {
        if (!safePath(path) || !local.allowed(path)) throw Error("Unsupported or reserved file path: " + path);
      }
      checkAliases([...paths].filter((path) => localPaths.has(path) || groups.get(path)?.some((r) => r.hash !== null)));
      const conflicts = [];
      let sent = 0, received = 0;
      for (const path of paths) {
        if (!active()) throw Error("Sync stopped.");
        let heads = groups.get(path) ?? [];
        const base = baseline.get(path);
        const bytes = await local.read(path);
        const hash = bytes === null ? null : await sha(bytes);
        const matching = heads.some((rev) => rev.hash === hash);
        const changed = base ? hash !== base.hash : bytes !== null;
        const alreadySplit = new Set(heads.map((rev) => rev.hash)).size > 1;
        if (changed && !matching && !alreadySplit) {
          const parents = base?.ids ?? [];
          const rev = await store.publish(path, parents, bytes);
          history.set(rev.id, rev);
          heads = [...heads.filter((r) => !parents.includes(r.id)), rev];
          sent++;
        }
        if (new Set(heads.map((rev) => rev.hash)).size > 1) {
          for (const rev2 of heads) {
            if (rev2.hash !== null) await local.archive(rev2, () => store.readBody(rev2));
          }
          if (resolve !== path || bytes === null) {
            if (!base && bytes === null) {
              const candidate = heads.filter((r) => r.hash !== null).sort((a, b) => a.id.localeCompare(b.id))[0];
              if (candidate) await local.apply(path, null, await store.readBody(candidate));
            }
            conflicts.push(path);
            continue;
          }
          const rev = await store.publish(path, heads.map((r) => r.id), bytes);
          history.set(rev.id, rev);
          heads = [rev];
          sent++;
        }
        if (!heads.length) continue;
        const target = heads[0];
        if (target.hash !== hash) {
          const content = target.hash === null ? null : await store.readBody(target);
          await local.apply(path, hash, content);
          received++;
        }
        const next = { ids: heads.map((r) => r.id).sort(), hash: target.hash };
        if (!base || JSON.stringify(base) !== JSON.stringify(next)) {
          baseline.set(path, next);
          checkpoint(baseline);
        }
      }
      return { history, sent, received, conflicts };
    }
    async function createVault(home, folder, passphrase, namespace2) {
      let current = home;
      for (const part of folder.split("/")) {
        try {
          await current.mkdir(part);
        } catch (e) {
          if (e.status !== 405) throw e;
        }
        current = current.child(part);
      }
      const entries = await current.list();
      if (entries.some((name) => !/^homebound-init-[0-9a-f]{32}$/.test(name))) {
        throw Error("Please choose an empty remote folder, or connect the existing vault. \u8BF7\u9009\u62E9\u7A7A\u76EE\u5F55\uFF0C\u6216\u8FDE\u63A5\u5DF2\u6709\u5E93\u3002");
      }
      const header = await newHeader(passphrase);
      const staging = "homebound-init-" + randomId();
      await current.mkdir(staging);
      const store = current.child(staging);
      await store.mkdir("objects");
      await store.mkdir("commits");
      await store.put("vault.json", jsonBytes(header).buffer);
      try {
        await current.call("MOVE", staging, [201], { headers: { Destination: current.child(namespace2).root, Overwrite: "F" } });
      } catch (error) {
        let existing;
        try {
          existing = parseBytes(await current.child(namespace2).read("vault.json"));
        } catch {
        }
        if (existing?.id !== header.id) throw error;
      }
      return header;
    }
    module2.exports = {
      createVault,
      Store,
      synchronize,
      safePath,
      isRecovery,
      conflictFolder,
      directory,
      endpoint,
      encodePath,
      newHeader,
      unlock,
      randomId,
      sha,
      jsonBytes,
      parseBytes
    };
  }
});

// src/adapter.cjs
var require_adapter = __commonJS({
  "src/adapter.cjs"(exports2, module2) {
    "use strict";
    var { Plugin: Plugin2, PluginSettingTab: PluginSettingTab2, Setting: Setting2, Modal: Modal2, Notice: Notice2, TFile: TFile2, TFolder: TFolder2, requestUrl: requestUrl2, getLanguage: getLanguage2 } = require("obsidian");
    var core2 = require_core();
    var tr2 = (en, zh) => getLanguage2().startsWith("zh") ? zh : en;
    var paused = () => new Error(tr2("File changed during sync. Run sync again.", "\u6587\u4EF6\u5728\u540C\u6B65\u671F\u95F4\u53D1\u751F\u53D8\u5316\uFF0C\u8BF7\u518D\u540C\u6B65\u4E00\u6B21\u3002"));
    var Dav2 = class _Dav {
      constructor(root, authorization) {
        this.root = root;
        this.authorization = authorization;
      }
      child(path) {
        return new _Dav(this.root + "/" + core2.encodePath(path), this.authorization);
      }
      async call(method, path, accepted, extras = {}) {
        const url = path ? this.root + "/" + core2.encodePath(path) : this.root;
        const headers = { ...extras.headers };
        if (this.authorization) headers.Authorization = this.authorization;
        let response;
        try {
          response = await requestUrl2({ url, method, ...extras, headers, throw: false });
        } catch {
          throw Object.assign(Error(tr2("Server unreachable. Check the route and TLS certificate.", "\u65E0\u6CD5\u8FDE\u63A5\u670D\u52A1\u5668\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u548C TLS \u8BC1\u4E66\u3002")), { offline: true });
        }
        if (!accepted.includes(response.status)) {
          throw Object.assign(Error(method + " returned HTTP " + response.status), {
            status: response.status,
            offline: [502, 503, 504].includes(response.status)
          });
        }
        return response;
      }
      async read(path) {
        return (await this.call("GET", path, [200])).arrayBuffer;
      }
      async put(path, body) {
        await this.call("PUT", path, [200, 201, 204], { body, contentType: "application/octet-stream" });
      }
      async mkdir(path) {
        await this.call("MKCOL", path, [201]);
      }
      async list(path = "") {
        const result = await this.call("PROPFIND", path, [207], {
          headers: { Depth: "1" },
          contentType: "application/xml; charset=utf-8",
          body: '<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>'
        });
        const xml = new DOMParser().parseFromString(result.text, "application/xml");
        const docs = (el, tag) => Array.from(el.getElementsByTagNameNS("DAV:", tag));
        if (xml.documentElement.localName !== "multistatus" || xml.documentElement.namespaceURI !== "DAV:") {
          throw Error("Invalid WebDAV directory response.");
        }
        const url = new URL(path ? this.child(path).root : this.root);
        const segments = (pathname) => pathname.replace(/\/+$/, "").split("/").map((x) => decodeURIComponent(x).normalize("NFC"));
        const base = segments(url.pathname);
        let self = false;
        const names = [];
        for (const entry of docs(xml, "response")) {
          const href = docs(entry, "href")[0]?.textContent;
          const successful = docs(entry, "status").some((s) => /^HTTP\/\S+ 2\d\d\b/i.test(s.textContent.trim()));
          if (!href || !successful) throw Error("Incomplete WebDAV directory response.");
          const item = segments(new URL(href, url.href.replace(/\/+$/, "") + "/").pathname);
          if (!base.every((part, i) => part === item[i])) throw Error("WebDAV returned an unexpected directory.");
          if (item.length === base.length) {
            self = true;
            continue;
          }
          if (item.length !== base.length + 1) throw Error("WebDAV returned an unexpected child path.");
          names.push(item[item.length - 1]);
        }
        if (!self) throw Error("WebDAV did not confirm the requested directory.");
        return names;
      }
    };
    function credentials2(username, password) {
      if (!username && !password) return "";
      if (!username || username.includes(":")) throw Error("Enter a valid WebDAV username.");
      const bytes = new TextEncoder().encode(username + ":" + password);
      return "Basic " + btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
    }
    var VaultFiles2 = class {
      constructor(app) {
        this.app = app;
        this.vault = app.vault;
      }
      allowed(path) {
        const first = path.split("/")[0].toLowerCase();
        return !core2.isRecovery(path) && first !== this.vault.configDir.toLowerCase() && !path.split("/").some((part) => part.startsWith("."));
      }
      paths() {
        return new Set(this.vault.getFiles().map((f) => f.path).filter((path) => this.allowed(path)));
      }
      file(path) {
        const item = this.vault.getAbstractFileByPath(path);
        if (item && (item.path !== path || !(item instanceof TFile2))) throw Error("File or folder collision: " + path);
        return item;
      }
      async read(path) {
        const file = this.file(path);
        return file ? this.vault.readBinary(file) : null;
      }
      async folders(path) {
        const parts = path.split("/").slice(0, -1);
        let name = "";
        for (const part of parts) {
          name += (name ? "/" : "") + part;
          let folder = this.vault.getAbstractFileByPath(name);
          if (!folder) {
            try {
              folder = await this.vault.createFolder(name);
            } catch (error) {
              folder = this.vault.getAbstractFileByPath(name);
              if (!folder) throw error;
            }
          }
          if (!(folder instanceof TFolder2) || folder.path !== name) throw Error("Folder collision: " + name);
        }
      }
      async apply(path, expected, bytes) {
        const old = await this.read(path);
        if ((old === null ? null : await core2.sha(old)) !== expected) throw paused();
        const file = this.file(path);
        if (old === null) {
          if (bytes !== null) {
            await this.folders(path);
            await this.vault.createBinary(path, bytes);
          }
          return;
        }
        if (!file) throw paused();
        if (bytes === null) {
          await this.app.fileManager.trashFile(file);
          return;
        }
        if (file.extension.toLowerCase() === "md") {
          const decode = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
          const before = decode.decode(old), after = decode.decode(bytes);
          await this.vault.process(file, (current) => {
            if (current !== before) throw paused();
            return after;
          });
        } else {
          await this.vault.modifyBinary(file, bytes);
        }
      }
      async archive(rev, body) {
        const path = core2.conflictFolder + "/" + rev.id + "/" + rev.path;
        const current = await this.read(path);
        if (current !== null) {
          if (await core2.sha(current) !== rev.hash) throw Error("Move your edited conflict copy before syncing: " + path);
          return;
        }
        await this.apply(path, null, await body());
      }
    };
    module2.exports = { Dav: Dav2, VaultFiles: VaultFiles2, credentials: credentials2 };
  }
});

// node_modules/@noble/hashes/_u64.js
function fromBig(n, le = false) {
  if (le)
    return { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) };
  return { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
}
function split(lst, le = false) {
  const len = lst.length;
  let Ah = new Uint32Array(len);
  let Al = new Uint32Array(len);
  for (let i = 0; i < len; i++) {
    const { h, l } = fromBig(lst[i], le);
    [Ah[i], Al[i]] = [h, l];
  }
  return [Ah, Al];
}
var U32_MASK64, _32n;
var init_u64 = __esm({
  "node_modules/@noble/hashes/_u64.js"() {
    U32_MASK64 = /* @__PURE__ */ (() => BigInt(2 ** 32 - 1))();
    _32n = /* @__PURE__ */ BigInt(32);
  }
});

// node_modules/@noble/hashes/utils.js
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
}
function anumber(n, title = "") {
  if (typeof n !== "number")
    throw new TypeError(atitle(title) + "expected number, got " + typeof n);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError(atitle(title) + "expected integer >= 0, got " + n);
  return n;
}
function abool(value, title = "") {
  if (typeof value !== "boolean")
    throw new TypeError(atitle(title) + "expected boolean, got type=" + typeof value);
  return value;
}
function abytes(value, length, title = "") {
  if (isBytes(value) && (length === void 0 || value.length === length))
    return value;
  if (length !== void 0)
    anumber(length, "length");
  const bytes = isBytes(value);
  const ofLen = length !== void 0 ? ` of length ${length}` : "";
  const got = bytes ? `length=${value.length}` : `type=${typeof value}`;
  const message = atitle(title) + "expected Uint8Array" + ofLen + ", got " + got;
  if (!bytes)
    throw new TypeError(message);
  throw new RangeError(message);
}
function ahash(h) {
  if (typeof h !== "function" || typeof h.create !== "function")
    throw new TypeError("expected hash wrapped by utils.createHasher");
  anumber(h.outputLen);
  anumber(h.blockLen);
  if (h.outputLen < 1 || h.blockLen < 1)
    throw new Error("hash blockLen / outputLen must be >= 1");
}
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("hash was destroyed");
  if (checkFinished && instance.finished)
    throw new Error("digest() was already called");
}
function aoutput(out, instance) {
  abytes(out, void 0, "output");
  const min = instance.outputLen;
  if (!(out.length >= min)) {
    throw new RangeError('"output" expected length >= ' + min);
  }
}
function u32(arr) {
  return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
}
function clean(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function byteSwap(word) {
  return word << 24 & 4278190080 | word << 8 & 16711680 | word >>> 8 & 65280 | word >>> 24 & 255;
}
function byteSwap32(arr) {
  for (let i = 0; i < arr.length; i++) {
    arr[i] = byteSwap(arr[i]);
  }
  return arr;
}
function bytesToHex(bytes) {
  abytes(bytes);
  if (hasHexBuiltin)
    return bytes.toHex();
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += hexes[bytes[i]];
  }
  return hex;
}
function concatBytes(...arrays) {
  let sum = 0;
  for (let i = 0; i < arrays.length; i++) {
    const a = arrays[i];
    abytes(a);
    sum += a.length;
  }
  const res = new Uint8Array(sum);
  for (let i = 0, pad = 0; i < arrays.length; i++) {
    const a = arrays[i];
    res.set(a, pad);
    pad += a.length;
  }
  return res;
}
function checkOpts(defaults, opts2, title = "opts") {
  aopts(defaults, "defaults");
  if (opts2 !== void 0)
    aopts(opts2, title);
  const merged = Object.assign(/* @__PURE__ */ Object.create(null), defaults, opts2);
  return merged;
}
function createHasher(hashCons, info = {}) {
  if (typeof hashCons !== "function")
    throw new TypeError('"hashCons" expected function, got type=' + typeof hashCons);
  info = checkOpts({}, info, "info");
  const hashC = (msg, opts2) => hashCons(opts2).update(msg).digest();
  const tmp = hashCons(void 0);
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.canXOF = tmp.canXOF;
  hashC.create = (opts2) => hashCons(opts2);
  Object.assign(hashC, info);
  return Object.freeze(hashC);
}
function randomBytes(bytesLength = 32) {
  anumber(bytesLength, "bytesLength");
  const cr = typeof globalThis === "object" ? globalThis.crypto : null;
  if (typeof cr?.getRandomValues !== "function")
    throw new Error("crypto.getRandomValues must be defined");
  if (bytesLength > 65536)
    throw new RangeError(`"bytesLength" expected <= 65536, got ${bytesLength}`);
  return cr.getRandomValues(new Uint8Array(bytesLength));
}
var atitle, aobject, aopts, isLE, swap32IfBE, hasHexBuiltin, hexes, oidNist;
var init_utils = __esm({
  "node_modules/@noble/hashes/utils.js"() {
    atitle = (title) => title ? `"${title}" ` : "";
    aobject = (value, label) => {
      if (value === null || typeof value !== "object" || Array.isArray(value))
        throw new TypeError((label === "object" ? "" : `"${label}" `) + "expected object, got type=" + typeof value);
    };
    aopts = (value, label) => {
      aobject(value, label);
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null)
        throw new TypeError(`"${label}" expected plain object`);
      if (Object.hasOwn(value, "__proto__"))
        throw new TypeError(`"${label}.__proto__" is not allowed`);
    };
    isLE = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
    swap32IfBE = isLE ? (u) => u : byteSwap32;
    hasHexBuiltin = /* @__PURE__ */ (() => (
      // @ts-ignore
      typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function"
    ))();
    hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
    oidNist = (suffix) => ({
      // Current NIST hashAlgs suffixes used here fit in one DER subidentifier octet.
      // Larger suffix values would need base-128 OID encoding and a different length byte.
      oid: Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2, suffix])
    });
  }
});

// node_modules/@noble/hashes/sha3.js
function keccakP(s, rounds = 24) {
  if (!(s instanceof Uint32Array))
    throw new TypeError('"s" expected Uint32Array(50), got type=' + typeof s);
  if (s.length !== 50)
    throw new RangeError('"s" expected Uint32Array(50), got length=' + s.length);
  anumber(rounds, "rounds");
  if (rounds < 1 || rounds > 24)
    throw new Error('"rounds" expected integer 1..24');
  for (let round = 24 - rounds; round < 24; round++) {
    for (let x = 0; x < 10; x++)
      B[x] = s[x] ^ s[x + 10] ^ s[x + 20] ^ s[x + 30] ^ s[x + 40];
    for (let x = 0; x < 10; x += 2) {
      const idx1 = (x + 8) % 10;
      const idx0 = (x + 2) % 10;
      const B0 = B[idx0];
      const B1 = B[idx0 + 1];
      const Th = rotlH(B0, B1, 1) ^ B[idx1];
      const Tl = rotlL(B0, B1, 1) ^ B[idx1 + 1];
      for (let y = 0; y < 50; y += 10) {
        s[x + y] ^= Th;
        s[x + y + 1] ^= Tl;
      }
    }
    let curH = s[2];
    let curL = s[3];
    for (let t = 0; t < 24; t++) {
      const shift = SHA3_ROTL[t];
      const Th = rotlH(curH, curL, shift);
      const Tl = rotlL(curH, curL, shift);
      const PI = SHA3_PI[t];
      curH = s[PI];
      curL = s[PI + 1];
      s[PI] = Th;
      s[PI + 1] = Tl;
    }
    for (let y = 0; y < 50; y += 10) {
      const b0 = s[y], b1 = s[y + 1], b2 = s[y + 2], b3 = s[y + 3];
      s[y] ^= ~s[y + 2] & s[y + 4];
      s[y + 1] ^= ~s[y + 3] & s[y + 5];
      s[y + 2] ^= ~s[y + 4] & s[y + 6];
      s[y + 3] ^= ~s[y + 5] & s[y + 7];
      s[y + 4] ^= ~s[y + 6] & s[y + 8];
      s[y + 5] ^= ~s[y + 7] & s[y + 9];
      s[y + 6] ^= ~s[y + 8] & b0;
      s[y + 7] ^= ~s[y + 9] & b1;
      s[y + 8] ^= ~b0 & b2;
      s[y + 9] ^= ~b1 & b3;
    }
    s[0] ^= SHA3_IOTA_H[round];
    s[1] ^= SHA3_IOTA_L[round];
  }
  clean(B);
}
var _0n, _1n, _2n, _7n, _256n, _0x71n, SHA3_PI, SHA3_ROTL, _SHA3_IOTA, IOTAS, SHA3_IOTA_H, SHA3_IOTA_L, rotlSH, rotlSL, rotlBH, rotlBL, rotlH, rotlL, B, Keccak, genKeccak, sha3_256, sha3_512, genShake, shake128, shake256;
var init_sha3 = __esm({
  "node_modules/@noble/hashes/sha3.js"() {
    init_u64();
    init_utils();
    _0n = BigInt(0);
    _1n = BigInt(1);
    _2n = BigInt(2);
    _7n = BigInt(7);
    _256n = BigInt(256);
    _0x71n = BigInt(113);
    SHA3_PI = [];
    SHA3_ROTL = [];
    _SHA3_IOTA = [];
    for (let round = 0, R = _1n, x = 1, y = 0; round < 24; round++) {
      [x, y] = [y, (2 * x + 3 * y) % 5];
      SHA3_PI.push(2 * (5 * y + x));
      SHA3_ROTL.push((round + 1) * (round + 2) / 2 % 64);
      let t = _0n;
      for (let j = 0; j < 7; j++) {
        R = (R << _1n ^ (R >> _7n) * _0x71n) % _256n;
        if (R & _2n)
          t ^= _1n << (_1n << BigInt(j)) - _1n;
      }
      _SHA3_IOTA.push(t);
    }
    IOTAS = split(_SHA3_IOTA, true);
    SHA3_IOTA_H = IOTAS[0];
    SHA3_IOTA_L = IOTAS[1];
    rotlSH = (h, l, s) => h << s | l >>> 32 - s;
    rotlSL = (h, l, s) => l << s | h >>> 32 - s;
    rotlBH = (h, l, s) => l << s - 32 | h >>> 64 - s;
    rotlBL = (h, l, s) => h << s - 32 | l >>> 64 - s;
    rotlH = (h, l, s) => s > 32 ? rotlBH(h, l, s) : rotlSH(h, l, s);
    rotlL = (h, l, s) => s > 32 ? rotlBL(h, l, s) : rotlSL(h, l, s);
    B = new Uint32Array(5 * 2);
    Keccak = class _Keccak {
      state;
      pos = 0;
      posOut = 0;
      finished = false;
      state32;
      destroyed = false;
      blockLen;
      suffix;
      outputLen;
      canXOF;
      enableXOF = false;
      rounds;
      // NOTE: we accept arguments in bytes instead of bits here.
      constructor(blockLen, suffix, outputLen, enableXOF = false, rounds = 24) {
        anumber(blockLen, "blockLen");
        anumber(suffix, "suffix");
        anumber(rounds, "rounds");
        abool(enableXOF, "enableXOF");
        this.blockLen = blockLen;
        this.suffix = suffix;
        this.outputLen = outputLen;
        this.enableXOF = enableXOF;
        this.canXOF = enableXOF;
        this.rounds = rounds;
        anumber(outputLen, "outputLen");
        if (!(0 < blockLen && blockLen < 200))
          throw new Error('"blockLen" must be 1..199');
        this.state = new Uint8Array(200);
        this.state32 = u32(this.state);
      }
      clone() {
        return this._cloneInto();
      }
      keccak() {
        swap32IfBE(this.state32);
        keccakP(this.state32, this.rounds);
        swap32IfBE(this.state32);
        this.posOut = 0;
        this.pos = 0;
      }
      update(data) {
        aexists(this);
        abytes(data);
        const { blockLen, state, state32 } = this;
        const len = data.length;
        const canUseU32 = blockLen % 4 === 0 && data.byteOffset % 4 === 0;
        const blockLen32 = blockLen / 4;
        const data32 = canUseU32 && len >= blockLen ? u32(data) : void 0;
        for (let pos = 0; pos < len; ) {
          if (data32 !== void 0 && this.pos === 0 && pos % 4 === 0 && len - pos >= blockLen) {
            for (let i = 0, o = pos / 4; i < blockLen32; i++)
              state32[i] ^= data32[o + i];
            pos += blockLen;
            this.pos = blockLen;
            this.keccak();
            continue;
          }
          const take = Math.min(blockLen - this.pos, len - pos);
          for (let i = 0; i < take; i++)
            state[this.pos++] ^= data[pos++];
          if (this.pos === blockLen)
            this.keccak();
        }
        return this;
      }
      finish() {
        if (this.finished)
          return;
        this.finished = true;
        const { state, suffix, pos, blockLen } = this;
        state[pos] ^= suffix;
        if ((suffix & 128) !== 0 && pos === blockLen - 1)
          this.keccak();
        state[blockLen - 1] ^= 128;
        this.keccak();
      }
      writeInto(out) {
        aexists(this, false);
        abytes(out);
        this.finish();
        const bufferOut = this.state;
        const { blockLen } = this;
        for (let pos = 0, len = out.length; pos < len; ) {
          if (this.posOut >= blockLen)
            this.keccak();
          const take = Math.min(blockLen - this.posOut, len - pos);
          out.set(bufferOut.subarray(this.posOut, this.posOut + take), pos);
          this.posOut += take;
          pos += take;
        }
        return out;
      }
      xofInto(out) {
        if (!this.enableXOF)
          throw new Error("XOF is not enabled");
        return this.writeInto(out);
      }
      xof(bytes) {
        anumber(bytes);
        return this.xofInto(new Uint8Array(bytes));
      }
      digestInto(out) {
        aoutput(out, this);
        if (this.finished)
          throw new Error("digest() was already called");
        this.writeInto(out.length === this.outputLen ? out : out.subarray(0, this.outputLen));
        this.destroy();
      }
      digest() {
        const out = new Uint8Array(this.outputLen);
        this.digestInto(out);
        return out;
      }
      destroy() {
        this.destroyed = true;
        clean(this.state);
      }
      _cloneInto(to) {
        const { blockLen, suffix, outputLen, rounds, enableXOF } = this;
        to ||= new _Keccak(blockLen, suffix, outputLen, enableXOF, rounds);
        to.blockLen = blockLen;
        to.state32.set(this.state32);
        to.pos = this.pos;
        to.posOut = this.posOut;
        to.finished = this.finished;
        to.rounds = rounds;
        to.suffix = suffix;
        to.outputLen = outputLen;
        to.enableXOF = enableXOF;
        to.canXOF = this.canXOF;
        to.destroyed = this.destroyed;
        return to;
      }
    };
    genKeccak = (suffix, blockLen, outputLen, info = {}) => createHasher(() => new Keccak(blockLen, suffix, outputLen), info);
    sha3_256 = /* @__PURE__ */ genKeccak(
      6,
      136,
      32,
      /* @__PURE__ */ oidNist(8)
    );
    sha3_512 = /* @__PURE__ */ genKeccak(
      6,
      72,
      64,
      /* @__PURE__ */ oidNist(10)
    );
    genShake = (suffix, blockLen, outputLen, info = {}) => createHasher((opts2 = {}) => {
      opts2 = checkOpts({}, opts2);
      return new Keccak(blockLen, suffix, opts2.dkLen === void 0 ? outputLen : opts2.dkLen, true);
    }, info);
    shake128 = /* @__PURE__ */ genShake(31, 168, 16, /* @__PURE__ */ oidNist(11));
    shake256 = /* @__PURE__ */ genShake(31, 136, 32, /* @__PURE__ */ oidNist(12));
  }
});

// node_modules/@noble/curves/utils.js
function aobject2(value, title = "object") {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(title === "object" ? "expected valid options object" : `"${title}" expected object, got type=${typeof value}`);
  return value;
}
function abool2(value, title = "") {
  if (typeof value !== "boolean")
    throw new TypeError(atitle2(title) + "expected boolean, got type=" + typeof value);
  return value;
}
function validateObject(object, fields = {}, optFields = {}, title = "object") {
  aobject2(object, title);
  aobject2(fields, "fields");
  aobject2(optFields, "optFields");
  function checkField(fieldName, expectedType, isOpt) {
    const label = title === "object" ? `param "${String(fieldName)}"` : `"${title}.${String(fieldName)}"`;
    const val = object[fieldName];
    if (!Object.hasOwn(object, fieldName) && (isOpt ? val !== void 0 : expectedType !== "function")) {
      throw new TypeError(`${label} is invalid: expected own property`);
    }
    if (isOpt && val === void 0)
      return;
    const current = typeof val;
    if (current !== expectedType || val === null)
      throw new TypeError(`${label} is invalid: expected ${expectedType}, got ${current}`);
  }
  const iter = (f, isOpt) => Object.entries(f).forEach(([k, v]) => checkField(k, v, isOpt));
  iter(fields, false);
  iter(optFields, true);
}
var atitle2;
var init_utils2 = __esm({
  "node_modules/@noble/curves/utils.js"() {
    atitle2 = (title) => title ? `"${title}" ` : "";
  }
});

// node_modules/@noble/curves/abstract/fft.js
function checkU32(n, title = "n") {
  if (typeof n !== "number")
    throw new TypeError(`wrong u32 integer "${title}": expected number, got type=${typeof n}`);
  if (!Number.isSafeInteger(n) || n < 0 || n > 4294967295)
    throw new RangeError(`wrong u32 integer "${title}": expected 0..4294967295, got ${n}`);
  return n;
}
function isPowerOfTwo(x) {
  checkU32(x, "x");
  return (x & x - 1) === 0 && x !== 0;
}
function reverseBits(n, bits) {
  checkU32(n);
  if (typeof bits !== "number")
    throw new TypeError('"bits" expected number, got type=' + typeof bits);
  if (!Number.isSafeInteger(bits) || bits < 0 || bits > 32)
    throw new Error(`expected integer 0 <= bits <= 32, got ${bits}`);
  let reversed = 0;
  for (let i = 0; i < bits; i++, n >>>= 1)
    reversed = reversed << 1 | n & 1;
  return reversed >>> 0;
}
function log2(n) {
  checkU32(n);
  return 31 - Math.clz32(n);
}
function bitReversalInplace(values) {
  if (!values || typeof values !== "object" || typeof values.length !== "number")
    throw new TypeError('"values" expected array-like, got type=' + typeof values);
  const n = values.length;
  if (!isPowerOfTwo(n))
    throw new Error("expected positive power-of-two length, got " + n);
  const bits = log2(n);
  for (let i = 0; i < n; i++) {
    const j = reverseBits(i, bits);
    if (i < j) {
      const tmp = values[i];
      values[i] = values[j];
      values[j] = tmp;
    }
  }
  return values;
}
var FFTCore;
var init_fft = __esm({
  "node_modules/@noble/curves/abstract/fft.js"() {
    init_utils2();
    FFTCore = (F3, coreOpts) => {
      validateObject(coreOpts, { N: "number", roots: "object", dit: "boolean" }, { invertButterflies: "boolean", skipStages: "number", brp: "boolean" }, "coreOpts");
      const { N: N3, roots, dit, invertButterflies = false, skipStages = 0, brp = true } = coreOpts;
      checkU32(N3, "coreOpts.N");
      const bits = log2(N3);
      if (!isPowerOfTwo(N3))
        throw new Error("FFT: Polynomial size should be power of two");
      checkU32(skipStages, "coreOpts.skipStages");
      const maxSkipStages = bits === 0 ? 0 : bits - 1;
      if (skipStages > maxSkipStages)
        throw new Error(`FFT: wrong skipStages: expected 0 <= skipStages <= ${maxSkipStages}`);
      if (roots.length !== N3)
        throw new Error(`FFT: wrong roots length: expected ${N3}, got ${roots.length}`);
      const isDit = dit !== invertButterflies;
      return (values) => {
        if (values.length !== N3)
          throw new Error("FFT: wrong Polynomial length");
        if (dit && brp)
          bitReversalInplace(values);
        for (let i = 0, g = 1; i < bits - skipStages; i++) {
          const s = dit ? i + 1 + skipStages : bits - i;
          const m = 1 << s;
          const m2 = m >> 1;
          const stride = N3 >> s;
          for (let k = 0; k < N3; k += m) {
            for (let j = 0, grp = g++; j < m2; j++) {
              const rootPos = invertButterflies ? dit ? N3 - grp : grp : j * stride;
              const i0 = k + j;
              const i1 = k + j + m2;
              const omega = roots[rootPos];
              const b = values[i1];
              const a = values[i0];
              if (isDit) {
                const t = F3.mul(b, omega);
                values[i0] = F3.add(a, t);
                values[i1] = F3.sub(a, t);
              } else if (invertButterflies) {
                values[i0] = F3.add(b, a);
                values[i1] = F3.mul(F3.sub(b, a), omega);
              } else {
                values[i0] = F3.add(a, b);
                values[i1] = F3.mul(F3.sub(a, b), omega);
              }
            }
          }
        }
        if (!dit && brp)
          bitReversalInplace(values);
        return values;
      };
    };
  }
});

// node_modules/@noble/post-quantum/utils.js
function aarray2(item, title, inner = () => {
}) {
  if (!Array.isArray(item))
    throw new TypeError(`"${title}" expected array, got type=${typeof item}`);
  for (let i = 0; i < item.length; i++)
    inner(item[i], `${title}[${i}]`);
  return item;
}
function aobject3(value, title = "object") {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(title === "object" ? "expected valid options object" : `"${title}" expected object, got type=${typeof value}`);
  return value;
}
function equalBytes(a, b) {
  a = abytes(a);
  b = abytes(b);
  if (a.length !== b.length)
    return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++)
    diff |= a[i] ^ b[i];
  return diff === 0;
}
function copyBytes(bytes) {
  return new Uint8Array(abytes(bytes));
}
function validateOpts(opts2) {
  if (isBytes(opts2))
    throw new TypeError('"opts" expected object, got Uint8Array');
  aobject3(opts2, "opts");
  const proto = Object.getPrototypeOf(opts2);
  if (proto !== null && proto !== Object.prototype)
    throw new TypeError('"opts" expected a plain object');
}
function checkOptKeys(opts2, allowed) {
  validateOpts(opts2);
  const normalized = Object.assign(/* @__PURE__ */ Object.create(null), opts2);
  for (const [k, v] of Object.entries(normalized)) {
    if (v === void 0)
      continue;
    if (!allowed.includes(k))
      throw new TypeError('unexpected option "' + String(k) + '"; expected one of: ' + allowed.join(", "));
  }
  return Object.freeze(normalized);
}
function validateVerOpts(opts2, allowed = VER_OPT_KEYS) {
  const normalized = checkOptKeys(opts2, allowed);
  if (normalized.context !== void 0)
    abytes(normalized.context, void 0, "opts.context");
  return normalized;
}
function validateSigOpts(opts2, allowed = SIG_OPT_KEYS) {
  const normalized = checkOptKeys(opts2, allowed);
  if (normalized.context !== void 0)
    abytes(normalized.context, void 0, "opts.context");
  if (normalized.extraEntropy !== false && normalized.extraEntropy !== void 0)
    abytes(normalized.extraEntropy, void 0, "opts.extraEntropy");
  return normalized;
}
function splitCoder(label, ...lengths) {
  const getLength = (c) => typeof c === "number" ? c : c.bytesLen;
  const bytesLen = lengths.reduce((sum, a) => sum + getLength(a), 0);
  return {
    bytesLen,
    encode: (bufs) => {
      const res = new Uint8Array(bytesLen);
      for (let i = 0, pos = 0; i < lengths.length; i++) {
        const c = lengths[i];
        const l = getLength(c);
        const b = typeof c === "number" ? bufs[i] : c.encode(bufs[i]);
        abytes(b, l, label);
        res.set(b, pos);
        if (typeof c !== "number")
          b.fill(0);
        pos += l;
      }
      return res;
    },
    decode: (buf) => {
      abytes(buf, bytesLen, label);
      const res = [];
      for (const c of lengths) {
        const l = getLength(c);
        const b = buf.subarray(0, l);
        res.push(typeof c === "number" ? b : c.decode(b));
        buf = buf.subarray(l);
      }
      return res;
    }
  };
}
function vecCoder(c, vecLen) {
  const coder = c;
  const bytesLen = vecLen * coder.bytesLen;
  return {
    bytesLen,
    encode: (u) => {
      const uArr = aarray2(u, "u");
      if (uArr.length !== vecLen)
        throw new RangeError(`vecCoder.encode: wrong length=${uArr.length}. Expected: ${vecLen}`);
      const res = new Uint8Array(bytesLen);
      for (let i = 0, pos = 0; i < uArr.length; i++) {
        const b = coder.encode(uArr[i]);
        res.set(b, pos);
        b.fill(0);
        pos += b.length;
      }
      return res;
    },
    decode: (a) => {
      abytes(a, bytesLen);
      const r = [];
      for (let i = 0; i < a.length; i += coder.bytesLen)
        r.push(coder.decode(a.subarray(i, i + coder.bytesLen)));
      return r;
    }
  };
}
function cleanBytes(...list) {
  for (const t of list) {
    if (Array.isArray(t))
      for (const b of t)
        b.fill(0);
    else
      t.fill(0);
  }
}
function getMask(bits) {
  anumber(bits, "bits");
  if (bits > 32)
    throw new RangeError('"bits" expected <= 32, got ' + bits);
  return bits === 32 ? 4294967295 : ~(-1 << bits) >>> 0;
}
function getMessage(msg, ctx = EMPTY) {
  abytes(msg, void 0, "msg");
  abytes(ctx, void 0, "ctx");
  if (ctx.length > 255)
    throw new RangeError("context should be 255 bytes or less");
  return concatBytes(new Uint8Array([0, ctx.length]), ctx, msg);
}
function checkHash(hash, requiredStrength = 0) {
  if (typeof hash !== "function" || typeof hash.create !== "function")
    throw new TypeError('"hash" expected hash function, got type=' + typeof hash);
  ahash(hash);
  anumber(requiredStrength, "requiredStrength");
  const oid = hash.oid;
  abytes(oid, void 0, "hash.oid");
  if (!equalBytes(oid.subarray(0, 10), oidNistP))
    throw new Error('"hash.oid" is invalid: expected NIST hash');
  const xofLen = XOF_OID_OUTPUT_LEN[bytesToHex(oid)];
  if (xofLen !== void 0 && hash.outputLen !== xofLen) {
    throw new Error("Pre-hash XOF output length must be " + xofLen + " bytes for this OID, got: " + hash.outputLen);
  }
  const collisionResistance = hash.outputLen * 8 / 2;
  if (requiredStrength > collisionResistance) {
    throw new Error("Pre-hash security strength too low: " + collisionResistance + ", required: " + requiredStrength);
  }
}
function getMessagePrehash(hash, msg, ctx = EMPTY) {
  checkHash(hash);
  abytes(msg, void 0, "msg");
  abytes(ctx, void 0, "ctx");
  if (ctx.length > 255)
    throw new RangeError("context should be 255 bytes or less");
  const hashed = hash(msg);
  return concatBytes(new Uint8Array([1, ctx.length]), ctx, hash.oid, hashed);
}
var abytesDoc, randomBytes2, VER_OPT_KEYS, SIG_OPT_KEYS, EMPTY, oidNistP, XOF_OID_OUTPUT_LEN;
var init_utils3 = __esm({
  "node_modules/@noble/post-quantum/utils.js"() {
    init_utils();
    abytesDoc = abytes;
    randomBytes2 = randomBytes;
    VER_OPT_KEYS = /* @__PURE__ */ Object.freeze([
      "context"
    ]);
    SIG_OPT_KEYS = /* @__PURE__ */ Object.freeze([
      "context",
      "extraEntropy"
    ]);
    EMPTY = /* @__PURE__ */ Uint8Array.of();
    oidNistP = /* @__PURE__ */ Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2]);
    XOF_OID_OUTPUT_LEN = /* @__PURE__ */ (() => ({
      "060960864801650304020b": 32,
      // id-shake128, SHAKE128(M, 256)
      "060960864801650304020c": 64
      // id-shake256, SHAKE256(M, 512)
    }))();
  }
});

// node_modules/@noble/post-quantum/_crystals.js
var genCrystals, createXofShake, XOF128, XOF256;
var init_crystals = __esm({
  "node_modules/@noble/post-quantum/_crystals.js"() {
    init_fft();
    init_sha3();
    init_utils3();
    genCrystals = (opts2) => {
      const { newPoly: newPoly2, N: N3, Q: Q3, F: F3, ROOT_OF_UNITY: ROOT_OF_UNITY3, brvBits, isKyber } = opts2;
      const mod = (a, modulo = Q3) => {
        const result = a % modulo | 0;
        return (result >= 0 ? result | 0 : modulo + result | 0) | 0;
      };
      const smod = (a, modulo = Q3) => {
        const r = mod(a, modulo) | 0;
        return (r > modulo >> 1 ? r - modulo | 0 : r) | 0;
      };
      function getZettas() {
        const out = newPoly2(N3);
        for (let i = 0; i < N3; i++) {
          const b = reverseBits(i, brvBits);
          const p = BigInt(ROOT_OF_UNITY3) ** BigInt(b) % BigInt(Q3);
          out[i] = Number(p) | 0;
        }
        return out;
      }
      const nttZetas = getZettas();
      const inv = (_a) => {
        throw new Error("not implemented");
      };
      const field = isKyber ? {
        add: (a, b) => {
          const r = a + b | 0;
          return r >= Q3 ? r - Q3 | 0 : r;
        },
        sub: (a, b) => {
          const r = a - b | 0;
          return r < 0 ? r + Q3 | 0 : r;
        },
        mul: (a, b) => mod((a | 0) * (b | 0)) | 0,
        inv
      } : {
        add: (a, b) => mod((a | 0) + (b | 0)) | 0,
        sub: (a, b) => mod((a | 0) - (b | 0)) | 0,
        mul: (a, b) => mod((a | 0) * (b | 0)) | 0,
        inv
      };
      const nttOpts = {
        N: N3,
        roots: nttZetas,
        invertButterflies: true,
        skipStages: isKyber ? 1 : 0,
        brp: false
      };
      const dif = FFTCore(field, { dit: false, ...nttOpts });
      const dit = FFTCore(field, { dit: true, ...nttOpts });
      const NTT = {
        encode: (r) => {
          return dif(r);
        },
        decode: (r) => {
          dit(r);
          for (let i = 0; i < r.length; i++)
            r[i] = mod(F3 * r[i]);
          return r;
        }
      };
      const bitsCoder = (d, c) => {
        for (let i = 0, bufLen = 0; i < N3; i++) {
          bufLen += d;
          if (bufLen > 32)
            getMask(bufLen);
          bufLen %= 8;
        }
        const mask = getMask(d);
        const bytesLen = d * (N3 / 8);
        return {
          bytesLen,
          encode: (poly_) => {
            const poly = poly_;
            const r = new Uint8Array(bytesLen);
            for (let i = 0, buf = 0, bufLen = 0, pos = 0; i < poly.length; i++) {
              buf |= (c.encode(poly[i]) & mask) << bufLen;
              bufLen += d;
              for (; bufLen >= 8; bufLen -= 8, buf >>= 8)
                r[pos++] = buf & 255;
            }
            return r;
          },
          decode: (bytes) => {
            const r = newPoly2(N3);
            for (let i = 0, buf = 0, bufLen = 0, pos = 0; i < bytes.length; i++) {
              buf |= bytes[i] << bufLen;
              bufLen += 8;
              for (; bufLen >= d; bufLen -= d, buf >>= d)
                r[pos++] = c.decode(buf & mask);
            }
            return r;
          }
        };
      };
      return {
        mod,
        smod,
        nttZetas,
        NTT: {
          encode: (r) => NTT.encode(r),
          decode: (r) => NTT.decode(r)
        },
        bitsCoder
      };
    };
    createXofShake = (shake) => (seed, blockLen) => {
      if (!blockLen)
        blockLen = shake.blockLen;
      const _seed = new Uint8Array(seed.length + 2);
      _seed.set(seed);
      const seedLen = seed.length;
      const buf = new Uint8Array(blockLen);
      let h = shake.create({});
      let calls = 0;
      let xofs = 0;
      return {
        stats: () => ({ calls, xofs }),
        get: (x, y) => {
          _seed[seedLen + 0] = x;
          _seed[seedLen + 1] = y;
          h.destroy();
          h = shake.create({}).update(_seed);
          calls++;
          return () => {
            xofs++;
            return h.xofInto(buf);
          };
        },
        clean: () => {
          h.destroy();
          cleanBytes(buf, _seed);
        }
      };
    };
    XOF128 = /* @__PURE__ */ createXofShake(shake128);
    XOF256 = /* @__PURE__ */ createXofShake(shake256);
  }
});

// node_modules/@noble/post-quantum/ml-kem.js
var ml_kem_exports = {};
__export(ml_kem_exports, {
  PARAMS: () => PARAMS,
  __tests: () => __tests,
  ml_kem1024: () => ml_kem1024,
  ml_kem512: () => ml_kem512,
  ml_kem768: () => ml_kem768
});
function polyAdd(a_, b_) {
  const a = a_;
  const b = b_;
  for (let i = 0; i < N; i++) {
    const r = a[i] + b[i];
    a[i] = r >= Q ? r - Q : r;
  }
}
function polySub(a_, b_) {
  const a = a_;
  const b = b_;
  for (let i = 0; i < N; i++) {
    const r = a[i] - b[i];
    a[i] = r < 0 ? r + Q : r;
  }
}
function BaseCaseMultiply(a0, a1, b0, b1, zeta) {
  const c0 = crystals.mod(crystals.mod(a1 * b1) * zeta + a0 * b0);
  const c1 = crystals.mod(a0 * b1 + a1 * b0);
  return { c0, c1 };
}
function MultiplyNTTs(f_, g_) {
  const f = f_;
  const g = g_;
  for (let i = 0; i < N / 2; i++) {
    let z = crystals.nttZetas[64 + (i >> 1)];
    if (i & 1)
      z = -z;
    const { c0, c1 } = BaseCaseMultiply(f[2 * i + 0], f[2 * i + 1], g[2 * i + 0], g[2 * i + 1], z);
    f[2 * i + 0] = c0;
    f[2 * i + 1] = c1;
  }
  return f;
}
function SampleNTT(xof_) {
  const xof = xof_;
  const r = new Uint16Array(N);
  for (let j = 0; j < N; ) {
    const b = xof();
    if (b.length % 3)
      throw new Error("SampleNTT: unaligned block");
    for (let i = 0; j < N && i + 3 <= b.length; i += 3) {
      const d1 = (b[i + 0] >> 0 | b[i + 1] << 8) & 4095;
      const d2 = (b[i + 1] >> 4 | b[i + 2] << 4) & 4095;
      if (d1 < Q)
        r[j++] = d1;
      if (j < N && d2 < Q)
        r[j++] = d2;
    }
  }
  return r;
}
function sampleCBD(PRF_, seed, nonce, eta) {
  const PRF = PRF_;
  return sampleCBDBytes(PRF(eta * N / 4, seed, nonce), eta);
}
function createKyber(opts2) {
  const rawOpts = opts2;
  const KPKE = genKPKE(rawOpts);
  const { HASH256, HASH512, KDF } = rawOpts;
  const { secretCoder: KPKESecretCoder, lengths } = KPKE;
  const secretCoder = splitCoder("secretKey", lengths.secretKey, lengths.publicKey, 32, 32);
  const msgLen = 32;
  const seedLen = 64;
  const validateModulus = (publicKey, fn) => {
    const eke = publicKey.subarray(0, 384 * rawOpts.K);
    const ek = KPKESecretCoder.encode(KPKESecretCoder.decode(copyBytes(eke)));
    const ok = equalBytes(ek, eke);
    cleanBytes(ek);
    if (!ok)
      throw new Error(`ML-KEM.${fn}: wrong publicKey modulus`);
  };
  const kemLengths = Object.freeze({
    ...lengths,
    seed: 64,
    msg: msgLen,
    msgRand: msgLen,
    secretKey: secretCoder.bytesLen
  });
  return Object.freeze({
    info: Object.freeze({ type: "ml-kem" }),
    lengths: kemLengths,
    keygen: (seed) => {
      const ownSeed = seed === void 0;
      const s = ownSeed ? randomBytes2(seedLen) : seed;
      let sk;
      let publicKeyHash;
      try {
        abytesDoc(s, seedLen, "seed");
        const keys = KPKE.keygen(s.subarray(0, 32));
        const publicKey = keys.publicKey;
        sk = keys.secretKey;
        publicKeyHash = HASH256(publicKey);
        const secretKey = secretCoder.encode([sk, publicKey, publicKeyHash, s.subarray(32)]);
        return {
          publicKey,
          secretKey
        };
      } finally {
        if (sk !== void 0)
          cleanBytes(sk);
        if (publicKeyHash !== void 0)
          cleanBytes(publicKeyHash);
        if (ownSeed)
          cleanBytes(s);
      }
    },
    getPublicKey: (secretKey) => {
      const [_sk, publicKey, _publicKeyHash, _z] = secretCoder.decode(secretKey);
      return Uint8Array.from(publicKey);
    },
    encapsulate: (publicKey, msg) => {
      const ownMsg = msg === void 0;
      const m = ownMsg ? randomBytes2(msgLen) : msg;
      let kr;
      try {
        abytesDoc(publicKey, lengths.publicKey, "publicKey");
        abytesDoc(m, msgLen, "message");
        validateModulus(publicKey, "encapsulate");
        kr = HASH512.create().update(m).update(HASH256(publicKey)).digest();
        const cipherText = KPKE.encrypt(publicKey, m, kr.subarray(32, 64));
        return {
          cipherText,
          sharedSecret: kr.subarray(0, 32)
        };
      } finally {
        if (kr !== void 0)
          cleanBytes(kr.subarray(32));
        if (ownMsg)
          cleanBytes(m);
      }
    },
    decapsulate: (cipherText, secretKey) => {
      abytesDoc(secretKey, secretCoder.bytesLen, "secretKey");
      abytesDoc(cipherText, lengths.cipherText, "cipherText");
      const k768 = secretCoder.bytesLen - 96;
      const start = k768 + 32;
      const test = HASH256(secretKey.subarray(k768 / 2, start));
      if (!equalBytes(test, secretKey.subarray(start, start + 32)))
        throw new Error("invalid secretKey: hash check failed");
      const [sk, publicKey, publicKeyHash, z] = secretCoder.decode(secretKey);
      const msg = KPKE.decrypt(cipherText, sk);
      const kr = HASH512.create().update(msg).update(publicKeyHash).digest();
      const Khat = kr.subarray(0, 32);
      const cipherText2 = KPKE.encrypt(publicKey, msg, kr.subarray(32, 64));
      const isValid = equalBytes(cipherText, cipherText2);
      const Kbar = KDF.create({ dkLen: 32 }).update(z).update(cipherText).digest();
      cleanBytes(msg, cipherText2, kr.subarray(32), !isValid ? Khat : Kbar);
      return isValid ? Khat : Kbar;
    },
    /**
     * Experimental prototype: pre-expand a public key so repeated encapsulate/decapsulate
     * against the same key skip re-validation, H(ek), t̂ decoding and the K² SampleNTT
     * XOF expansions of Â. Only public data is cached; see {@link KEMPrepared}.
     */
    prepare: (publicKey) => {
      abytesDoc(publicKey, lengths.publicKey, "publicKey");
      validateModulus(publicKey, "prepare");
      const ek = copyBytes(publicKey);
      const publicKeyHash = HASH256(ek);
      const cached = KPKE.prepare(ek);
      return Object.freeze({
        publicKey: ek,
        encapsulate: (msg) => {
          const ownMsg = msg === void 0;
          const m = ownMsg ? randomBytes2(msgLen) : msg;
          let kr;
          try {
            abytesDoc(m, msgLen, "message");
            kr = HASH512.create().update(m).update(publicKeyHash).digest();
            const cipherText = cached.encrypt(m, kr.subarray(32, 64));
            return {
              cipherText,
              sharedSecret: kr.subarray(0, 32)
            };
          } finally {
            if (kr !== void 0)
              cleanBytes(kr.subarray(32));
            if (ownMsg)
              cleanBytes(m);
          }
        },
        decapsulate: (cipherText, secretKey) => {
          abytesDoc(secretKey, secretCoder.bytesLen, "secretKey");
          abytesDoc(cipherText, lengths.cipherText, "cipherText");
          const [sk, ekEmbedded, storedHash, z] = secretCoder.decode(secretKey);
          if (!equalBytes(ekEmbedded, ek) || !equalBytes(storedHash, publicKeyHash))
            throw new Error("ML-KEM.decapsulate: secretKey does not match prepared publicKey");
          const msg = KPKE.decrypt(cipherText, sk);
          const kr = HASH512.create().update(msg).update(publicKeyHash).digest();
          const Khat = kr.subarray(0, 32);
          const cipherText2 = cached.encrypt(msg, kr.subarray(32, 64));
          const isValid = equalBytes(cipherText, cipherText2);
          const Kbar = KDF.create({ dkLen: 32 }).update(z).update(cipherText).digest();
          cleanBytes(msg, cipherText2, kr.subarray(32), !isValid ? Khat : Kbar);
          return isValid ? Khat : Kbar;
        },
        clean: cached.clean
      });
    }
  });
}
function shakePRF(dkLen, key, nonce) {
  return shake256.create({ dkLen }).update(key).update(new Uint8Array([nonce])).digest();
}
var N, Q, F, ROOT_OF_UNITY, crystals, PARAMS, compress, byteCoder, polyCoder, sampleCBDBytes, genKPKE, opts, mk, ml_kem512, ml_kem768, ml_kem1024, __tests;
var init_ml_kem = __esm({
  "node_modules/@noble/post-quantum/ml-kem.js"() {
    init_sha3();
    init_utils();
    init_crystals();
    init_utils3();
    N = 256;
    Q = 3329;
    F = 3303;
    ROOT_OF_UNITY = 17;
    crystals = /* @__PURE__ */ genCrystals({
      N,
      Q,
      F,
      ROOT_OF_UNITY,
      newPoly: (n) => new Uint16Array(n),
      brvBits: 7,
      isKyber: true
    });
    PARAMS = /* @__PURE__ */ (() => Object.freeze({
      512: Object.freeze({ N, Q, K: 2, ETA1: 3, ETA2: 2, du: 10, dv: 4, RBGstrength: 128 }),
      768: Object.freeze({ N, Q, K: 3, ETA1: 2, ETA2: 2, du: 10, dv: 4, RBGstrength: 192 }),
      1024: Object.freeze({ N, Q, K: 4, ETA1: 2, ETA2: 2, du: 11, dv: 5, RBGstrength: 256 })
    }))();
    compress = (d) => {
      if (d >= 12)
        return { encode: (i) => i, decode: (i) => i >= Q ? i - Q : i };
      const a = 2 ** (d - 1);
      return {
        // This only matches standalone Compress_d after bitsCoder masks the result into Z_(2^d).
        encode: (i) => ((i << d) + Q / 2) / Q,
        // const decompress = (i: number) => round((Q / 2 ** d) * i);
        decode: (i) => i * Q + a >>> d
      };
    };
    byteCoder = (d) => crystals.bitsCoder(d, d === 12 ? { encode: (i) => i, decode: (i) => i >= Q ? i - Q : i } : { encode: (i) => i, decode: (i) => i });
    polyCoder = (d) => d === 12 ? byteCoder(12) : crystals.bitsCoder(d, compress(d));
    sampleCBDBytes = (buf, eta) => {
      const r = new Uint16Array(N);
      const b32 = u32(buf);
      swap32IfBE(b32);
      let len = 0;
      for (let i = 0, p = 0, bb = 0, t0 = 0; i < b32.length; i++) {
        let b = b32[i];
        for (let j = 0; j < 32; j++) {
          bb += b & 1;
          b >>= 1;
          len += 1;
          if (len === eta) {
            t0 = bb;
            bb = 0;
          } else if (len === 2 * eta) {
            r[p++] = crystals.mod(t0 - bb);
            bb = 0;
            len = 0;
          }
        }
      }
      swap32IfBE(b32);
      if (len)
        throw new Error(`sampleCBD: leftover bits: ${len}`);
      return r;
    };
    genKPKE = (opts_) => {
      const opts2 = opts_;
      const { K, PRF, XOF, HASH512, ETA1, ETA2, du, dv } = opts2;
      const poly1 = polyCoder(1);
      const polyV = polyCoder(dv);
      const polyU = polyCoder(du);
      const publicCoder = splitCoder("publicKey", vecCoder(polyCoder(12), K), 32);
      const secretCoder = vecCoder(polyCoder(12), K);
      const cipherCoder = splitCoder("ciphertext", vecCoder(polyU, K), polyV);
      const seedCoder = splitCoder("seed", 32, 32);
      const encryptCore = (tHat, getA, msg, seed) => {
        const rHat = [];
        for (let i = 0; i < K; i++)
          rHat.push(crystals.NTT.encode(sampleCBD(PRF, seed, i, ETA1)));
        const tmp2 = new Uint16Array(N);
        const u = [];
        for (let i = 0; i < K; i++) {
          const e1 = sampleCBD(PRF, seed, K + i, ETA2);
          const tmp = new Uint16Array(N);
          for (let j = 0; j < K; j++) {
            const aij = getA(i, j);
            polyAdd(tmp, MultiplyNTTs(aij, rHat[j]));
          }
          polyAdd(e1, crystals.NTT.decode(tmp));
          u.push(e1);
          polyAdd(tmp2, MultiplyNTTs(tHat[i], rHat[i]));
          cleanBytes(tmp);
        }
        const e2 = sampleCBD(PRF, seed, 2 * K, ETA2);
        polyAdd(e2, crystals.NTT.decode(tmp2));
        const v = poly1.decode(msg);
        polyAdd(v, e2);
        cleanBytes(tHat, rHat, tmp2, e2);
        return cipherCoder.encode([u, v]);
      };
      return {
        secretCoder,
        lengths: {
          secretKey: secretCoder.bytesLen,
          publicKey: publicCoder.bytesLen,
          cipherText: cipherCoder.bytesLen
        },
        keygen: (seed) => {
          abytesDoc(seed, 32, "seed");
          const seedDst = new Uint8Array(33);
          seedDst.set(seed);
          seedDst[32] = K;
          const seedHash = HASH512(seedDst);
          const [rho, sigma] = seedCoder.decode(seedHash);
          const sHat = [];
          const tHat = [];
          for (let i = 0; i < K; i++)
            sHat.push(crystals.NTT.encode(sampleCBD(PRF, sigma, i, ETA1)));
          const x = XOF(rho);
          for (let i = 0; i < K; i++) {
            const e = crystals.NTT.encode(sampleCBD(PRF, sigma, K + i, ETA1));
            for (let j = 0; j < K; j++) {
              const aji = SampleNTT(x.get(j, i));
              polyAdd(e, MultiplyNTTs(aji, sHat[j]));
            }
            tHat.push(e);
          }
          x.clean();
          const res = {
            publicKey: publicCoder.encode([tHat, rho]),
            secretKey: secretCoder.encode(sHat)
          };
          cleanBytes(rho, sigma, sHat, tHat, seedDst, seedHash);
          return res;
        },
        encrypt: (publicKey, msg, seed) => {
          const [tHat, rho] = publicCoder.decode(publicKey);
          const x = XOF(rho);
          const res = encryptCore(tHat, (i, j) => SampleNTT(x.get(i, j)), msg, seed);
          x.clean();
          return res;
        },
        // Expands the full Â matrix (public data derived from rho) once, so repeated encryptions
        // against the same ek skip the K² SampleNTT XOF expansions. Cached polys are copied per
        // call because encryptCore mutates its inputs in place.
        prepare: (publicKey) => {
          const [tHat, rho] = publicCoder.decode(publicKey);
          const x = XOF(rho);
          const A = [];
          for (let i = 0; i < K; i++)
            for (let j = 0; j < K; j++)
              A.push(SampleNTT(x.get(i, j)));
          x.clean();
          return {
            encrypt: (msg, seed) => encryptCore(tHat.map((p) => p.slice()), (i, j) => A[i * K + j].slice(), msg, seed),
            clean: () => cleanBytes(tHat, A)
          };
        },
        decrypt: (cipherText, privateKey) => {
          const [u, v] = cipherCoder.decode(cipherText);
          const sk = secretCoder.decode(privateKey);
          const tmp = new Uint16Array(N);
          for (let i = 0; i < K; i++)
            polyAdd(tmp, MultiplyNTTs(sk[i], crystals.NTT.encode(u[i])));
          polySub(v, crystals.NTT.decode(tmp));
          const res = poly1.encode(v);
          cleanBytes(tmp, sk, u, v);
          return res;
        }
      };
    };
    opts = /* @__PURE__ */ (() => ({
      HASH256: sha3_256,
      HASH512: sha3_512,
      KDF: shake256,
      XOF: XOF128,
      PRF: shakePRF
    }))();
    mk = (params) => createKyber({
      ...opts,
      ...params
    });
    ml_kem512 = /* @__PURE__ */ (() => mk(PARAMS[512]))();
    ml_kem768 = /* @__PURE__ */ (() => mk(PARAMS[768]))();
    ml_kem1024 = /* @__PURE__ */ (() => mk(PARAMS[1024]))();
    __tests = /* @__PURE__ */ (() => Object.freeze({
      Compress_d: (x, d) => {
        if (d < 1 || d > 11)
          throw new Error(`Compress_d: expected d in [1..11], got ${d}`);
        return compress(d).encode(x) & getMask(d);
      },
      Decompress_d: (y, d) => {
        if (d < 1 || d > 11)
          throw new Error(`Decompress_d: expected d in [1..11], got ${d}`);
        return compress(d).decode(y);
      },
      ByteEncode_d: (F3, d) => {
        if (d < 1 || d > 12)
          throw new Error(`ByteEncode_d: expected d in [1..12], got ${d}`);
        return byteCoder(d).encode(F3);
      },
      ByteDecode_d: (B2, d) => {
        if (d < 1 || d > 12)
          throw new Error(`ByteDecode_d: expected d in [1..12], got ${d}`);
        return byteCoder(d).decode(B2);
      },
      NTT: (f) => crystals.NTT.encode(Uint16Array.from(f)),
      NTT_inv: (fHat) => crystals.NTT.decode(Uint16Array.from(fHat)),
      MultiplyNTTs: (fHat, gHat) => MultiplyNTTs(Uint16Array.from(fHat), Uint16Array.from(gHat)),
      SamplePolyCBD: (B2, eta) => {
        abytesDoc(B2, 64 * eta, "B");
        return sampleCBDBytes(B2, eta);
      },
      SampleNTT: (B2) => {
        abytesDoc(B2, 34, "B");
        const xof = XOF128(B2.subarray(0, 32));
        try {
          return SampleNTT(xof.get(B2[32], B2[33]));
        } finally {
          xof.clean();
        }
      }
    }))();
  }
});

// node_modules/@noble/post-quantum/ml-dsa.js
var ml_dsa_exports = {};
__export(ml_dsa_exports, {
  PARAMS: () => PARAMS2,
  ml_dsa44: () => ml_dsa44,
  ml_dsa65: () => ml_dsa65,
  ml_dsa87: () => ml_dsa87
});
function validateInternalOpts(opts2, allowed) {
  const normalized = checkOptKeys(opts2, allowed);
  if (normalized.externalMu !== void 0)
    abool2(normalized.externalMu, "opts.externalMu");
  return normalized;
}
function RejNTTPoly(xof_) {
  const xof = xof_;
  const r = newPoly(N2);
  for (let j = 0; j < N2; ) {
    const b = xof();
    if (b.length % 3)
      throw new Error("RejNTTPoly: unaligned block");
    for (let i = 0; j < N2 && i <= b.length - 3; i += 3) {
      const t = (b[i + 0] | b[i + 1] << 8 | b[i + 2] << 16) & 8388607;
      if (t < Q2)
        r[j++] = t;
    }
  }
  return r;
}
function getDilithium(opts_) {
  const opts2 = opts_;
  const { K, L, GAMMA1, GAMMA2, TAU, ETA, OMEGA } = opts2;
  const { CRH_BYTES, TR_BYTES, C_TILDE_BYTES, XOF128: XOF1282, XOF256: XOF2562, securityLevel } = opts2;
  if (![2, 4].includes(ETA))
    throw new Error("Wrong ETA");
  if (![1 << 17, 1 << 19].includes(GAMMA1))
    throw new Error("Wrong GAMMA1");
  if (![GAMMA2_1, GAMMA2_2].includes(GAMMA2))
    throw new Error("Wrong GAMMA2");
  const BETA = TAU * ETA;
  const decompose = (r) => {
    const rPlus = crystals2.mod(r);
    const r0 = crystals2.smod(rPlus, 2 * GAMMA2) | 0;
    if (rPlus - r0 === Q2 - 1)
      return { r1: 0 | 0, r0: r0 - 1 | 0 };
    const r1 = Math.floor((rPlus - r0) / (2 * GAMMA2)) | 0;
    return { r1, r0 };
  };
  const HighBits = (r) => decompose(r).r1;
  const LowBits = (r) => decompose(r).r0;
  const MakeHint = (z, r) => {
    const res0 = z <= GAMMA2 || z > Q2 - GAMMA2 || z === Q2 - GAMMA2 && r === 0 ? 0 : 1;
    return res0;
  };
  const HINT_M = Math.floor((Q2 - 1) / (2 * GAMMA2));
  const UseHint = (h, r) => {
    const { r1, r0 } = decompose(r);
    if (h === 1)
      return r0 > 0 ? crystals2.mod(r1 + 1, HINT_M) | 0 : crystals2.mod(r1 - 1, HINT_M) | 0;
    return r1 | 0;
  };
  const Power2Round = (r) => {
    const rPlus = crystals2.mod(r);
    const r0 = crystals2.smod(rPlus, 2 ** D) | 0;
    return { r1: Math.floor((rPlus - r0) / 2 ** D) | 0, r0 };
  };
  const hintCoder = {
    bytesLen: OMEGA + K,
    encode: (h_) => {
      const h = h_;
      if (h === false)
        throw new Error("hint.encode: hint is false");
      const res = new Uint8Array(OMEGA + K);
      for (let i = 0, k = 0; i < K; i++) {
        for (let j = 0; j < N2; j++)
          if (h[i][j] !== 0)
            res[k++] = j;
        res[OMEGA + i] = k;
      }
      return res;
    },
    decode: (buf) => {
      const h = [];
      let k = 0;
      for (let i = 0; i < K; i++) {
        const hi = newPoly(N2);
        if (buf[OMEGA + i] < k || buf[OMEGA + i] > OMEGA)
          return false;
        for (let j = k; j < buf[OMEGA + i]; j++) {
          if (j > k && buf[j] <= buf[j - 1])
            return false;
          hi[buf[j]] = 1;
        }
        k = buf[OMEGA + i];
        h.push(hi);
      }
      for (let j = k; j < OMEGA; j++)
        if (buf[j] !== 0)
          return false;
      return h;
    }
  };
  const ETACoder = polyCoder2(ETA === 2 ? 3 : 4, (i) => ETA - i, (i) => {
    if (!(-ETA <= i && i <= ETA))
      throw new Error(`malformed key s1/s3 ${i} outside of ETA range [${-ETA}, ${ETA}]`);
    return i;
  });
  const T0Coder = polyCoder2(13, (i) => (1 << D - 1) - i);
  const T1Coder = polyCoder2(10);
  const ZCoder = polyCoder2(GAMMA1 === 1 << 17 ? 18 : 20, (i) => crystals2.smod(GAMMA1 - i));
  const W1Coder = polyCoder2(GAMMA2 === GAMMA2_1 ? 6 : 4);
  const W1Vec = vecCoder(W1Coder, K);
  const publicCoder = splitCoder("publicKey", 32, vecCoder(T1Coder, K));
  const secretCoder = splitCoder("secretKey", 32, 32, TR_BYTES, vecCoder(ETACoder, L), vecCoder(ETACoder, K), vecCoder(T0Coder, K));
  const sigCoder = splitCoder("signature", C_TILDE_BYTES, vecCoder(ZCoder, L), hintCoder);
  const CoefFromHalfByte = ETA === 2 ? (n) => n < 15 ? 2 - n % 5 : false : (n) => n < 9 ? 4 - n : false;
  function RejBoundedPoly(xof_) {
    const xof = xof_;
    const r = newPoly(N2);
    for (let j = 0; j < N2; ) {
      const b = xof();
      for (let i = 0; j < N2 && i < b.length; i += 1) {
        const d1 = CoefFromHalfByte(b[i] & 15);
        const d2 = CoefFromHalfByte(b[i] >> 4 & 15);
        if (d1 !== false)
          r[j++] = d1;
        if (j < N2 && d2 !== false)
          r[j++] = d2;
      }
    }
    return r;
  }
  const SampleInBall = (seed) => {
    const pre = newPoly(N2);
    const s = shake256.create({}).update(seed);
    const buf = new Uint8Array(shake256.blockLen);
    s.xofInto(buf);
    const masks = buf.slice(0, 8);
    for (let i = N2 - TAU, pos = 8, maskPos = 0, maskBit = 0; i < N2; i++) {
      let b = i + 1;
      for (; b > i; ) {
        b = buf[pos++];
        if (pos < shake256.blockLen)
          continue;
        s.xofInto(buf);
        pos = 0;
      }
      pre[i] = pre[b];
      pre[b] = 1 - ((masks[maskPos] >> maskBit++ & 1) << 1);
      if (maskBit >= 8) {
        maskPos++;
        maskBit = 0;
      }
    }
    return pre;
  };
  const polyPowerRound = (p_) => {
    const p = p_;
    const res0 = newPoly(N2);
    const res1 = newPoly(N2);
    for (let i = 0; i < p.length; i++) {
      const { r0, r1 } = Power2Round(p[i]);
      res0[i] = r0;
      res1[i] = r1;
    }
    return { r0: res0, r1: res1 };
  };
  const polyUseHint = (u_, h_) => {
    const u = u_;
    const h = h_;
    for (let i = 0; i < N2; i++)
      u[i] = UseHint(h[i], u[i]);
    return u;
  };
  const polyMakeHint = (a_, b_) => {
    const a = a_;
    const b = b_;
    const v = newPoly(N2);
    let cnt = 0;
    for (let i = 0; i < N2; i++) {
      const h = MakeHint(a[i], b[i]);
      v[i] = h;
      cnt += h;
    }
    return { v, cnt };
  };
  const signRandBytes = 32;
  const seedCoder = splitCoder("seed", 32, 64, 32);
  const internal = Object.freeze({
    info: Object.freeze({ type: "internal-ml-dsa" }),
    lengths: Object.freeze({
      secretKey: secretCoder.bytesLen,
      publicKey: publicCoder.bytesLen,
      seed: 32,
      signature: sigCoder.bytesLen,
      signRand: signRandBytes
    }),
    keygen: (seed) => {
      const seedDst = new Uint8Array(32 + 2);
      const randSeed = seed === void 0;
      if (randSeed)
        seed = randomBytes2(32);
      abytesDoc(seed, 32, "seed");
      seedDst.set(seed);
      if (randSeed)
        cleanBytes(seed);
      seedDst[32] = K;
      seedDst[33] = L;
      const [rho, rhoPrime, K_] = seedCoder.decode(shake256(seedDst, { dkLen: seedCoder.bytesLen }));
      const xofPrime = XOF2562(rhoPrime);
      const s1 = [];
      for (let i = 0; i < L; i++)
        s1.push(RejBoundedPoly(xofPrime.get(i & 255, i >> 8 & 255)));
      const s2 = [];
      for (let i = L; i < L + K; i++)
        s2.push(RejBoundedPoly(xofPrime.get(i & 255, i >> 8 & 255)));
      const s1Hat = s1.map((i) => crystals2.NTT.encode(i.slice()));
      const t0 = [];
      const t1 = [];
      const xof = XOF1282(rho);
      const t = newPoly(N2);
      for (let i = 0; i < K; i++) {
        cleanBytes(t);
        for (let j = 0; j < L; j++) {
          const aij = RejNTTPoly(xof.get(j, i));
          polyAdd2(t, MultiplyNTTs2(aij, s1Hat[j]));
        }
        crystals2.NTT.decode(t);
        const { r0, r1 } = polyPowerRound(polyAdd2(t, s2[i]));
        t0.push(r0);
        t1.push(r1);
      }
      const publicKey = publicCoder.encode([rho, t1]);
      const tr2 = shake256(publicKey, { dkLen: TR_BYTES });
      const secretKey = secretCoder.encode([rho, K_, tr2, s1, s2, t0]);
      xof.clean();
      xofPrime.clean();
      cleanBytes(rho, rhoPrime, K_, s1, s2, s1Hat, t, t0, t1, tr2, seedDst);
      return {
        publicKey,
        secretKey
      };
    },
    getPublicKey: (secretKey) => {
      const [rho, _K, _tr, s1, s2, _t0] = secretCoder.decode(secretKey);
      const xof = XOF1282(rho);
      const s1Hat = s1.map((p) => crystals2.NTT.encode(p.slice()));
      const t1 = [];
      const tmp = newPoly(N2);
      for (let i = 0; i < K; i++) {
        tmp.fill(0);
        for (let j = 0; j < L; j++) {
          const aij = RejNTTPoly(xof.get(j, i));
          polyAdd2(tmp, MultiplyNTTs2(aij, s1Hat[j]));
        }
        crystals2.NTT.decode(tmp);
        polyAdd2(tmp, s2[i]);
        const { r1 } = polyPowerRound(tmp);
        t1.push(r1);
      }
      xof.clean();
      cleanBytes(tmp, s1Hat, _t0, s1, s2);
      return publicCoder.encode([rho, t1]);
    },
    // NOTE: random is optional.
    sign: (msg, secretKey, opts3 = {}) => {
      opts3 = validateSigOpts(opts3, INTERNAL_SIG_OPT_KEYS);
      opts3 = validateInternalOpts(opts3, INTERNAL_SIG_OPT_KEYS);
      const { extraEntropy: random, externalMu = false } = opts3;
      if (externalMu)
        abytesDoc(msg, CRH_BYTES, "mu");
      const ownRnd = random === false || random === void 0;
      const rnd = random === false ? new Uint8Array(32) : random === void 0 ? randomBytes2(signRandBytes) : random;
      abytesDoc(rnd, 32, "extraEntropy");
      const decoded = (() => {
        try {
          return secretCoder.decode(secretKey);
        } catch (error) {
          if (ownRnd)
            cleanBytes(rnd);
          throw error;
        }
      })();
      const [rho, _K, tr2, s1, s2, t0] = decoded;
      const A = [];
      const xof = XOF1282(rho);
      for (let i = 0; i < K; i++) {
        const pv = [];
        for (let j = 0; j < L; j++)
          pv.push(RejNTTPoly(xof.get(j, i)));
        A.push(pv);
      }
      xof.clean();
      for (let i = 0; i < L; i++)
        crystals2.NTT.encode(s1[i]);
      for (let i = 0; i < K; i++) {
        crystals2.NTT.encode(s2[i]);
        crystals2.NTT.encode(t0[i]);
      }
      const mu = externalMu ? msg : (
        // 6: µ ← H(tr||M, 512)
        //    ▷ Compute message representative µ
        shake256.create({ dkLen: CRH_BYTES }).update(tr2).update(msg).digest()
      );
      const rhoprime = shake256.create({ dkLen: CRH_BYTES }).update(_K).update(rnd).update(mu).digest();
      if (ownRnd)
        cleanBytes(rnd);
      abytesDoc(rhoprime, CRH_BYTES);
      const x256 = XOF2562(rhoprime, ZCoder.bytesLen);
      main_loop: for (let kappa = 0; ; ) {
        const y = [];
        for (let i = 0; i < L; i++, kappa++)
          y.push(ZCoder.decode(x256.get(kappa & 255, kappa >> 8)()));
        const z = y.map((i) => crystals2.NTT.encode(i.slice()));
        const w = [];
        for (let i = 0; i < K; i++) {
          const wi = newPoly(N2);
          for (let j = 0; j < L; j++)
            polyAdd2(wi, MultiplyNTTs2(A[i][j], z[j]));
          crystals2.NTT.decode(wi);
          w.push(wi);
        }
        const w1 = w.map((j) => j.map(HighBits));
        const cTilde = shake256.create({ dkLen: C_TILDE_BYTES }).update(mu).update(W1Vec.encode(w1)).digest();
        const cHat = crystals2.NTT.encode(SampleInBall(cTilde));
        const cs1 = s1.map((i) => MultiplyNTTs2(i, cHat));
        for (let i = 0; i < L; i++) {
          polyAdd2(crystals2.NTT.decode(cs1[i]), y[i]);
          if (polyChknorm(cs1[i], GAMMA1 - BETA)) {
            cleanBytes(cTilde, cs1, cHat, w1, w, z, y);
            continue main_loop;
          }
        }
        let cnt = 0;
        const h = [];
        for (let i = 0; i < K; i++) {
          const cs2 = crystals2.NTT.decode(MultiplyNTTs2(s2[i], cHat));
          const r0 = polySub2(w[i], cs2).map(LowBits);
          if (polyChknorm(r0, GAMMA2 - BETA)) {
            cleanBytes(cTilde, cs1, cHat, w1, w, z, y, h, cs2, r0);
            continue main_loop;
          }
          const ct0 = crystals2.NTT.decode(MultiplyNTTs2(t0[i], cHat));
          if (polyChknorm(ct0, GAMMA2)) {
            cleanBytes(cTilde, cs1, cHat, w1, w, z, y, h, cs2, r0, ct0);
            continue main_loop;
          }
          polyAdd2(r0, ct0);
          const hint = polyMakeHint(r0, w1[i]);
          h.push(hint.v);
          cnt += hint.cnt;
        }
        if (cnt > OMEGA) {
          cleanBytes(cTilde, cs1, cHat, w1, w, z, y, h);
          continue;
        }
        x256.clean();
        const res = sigCoder.encode([cTilde, cs1, h]);
        cleanBytes(cTilde, cs1, h, cHat, w1, w, z, y, rhoprime, s1, s2, t0, ...A);
        if (!externalMu)
          cleanBytes(mu);
        return res;
      }
      throw new Error("Unreachable code path reached, report this error");
    },
    verify: (sig, msg, publicKey, opts3 = {}) => {
      opts3 = validateInternalOpts(opts3, INTERNAL_VER_OPT_KEYS);
      const { externalMu = false } = opts3;
      if (externalMu)
        abytesDoc(msg, CRH_BYTES, "mu");
      const [rho, t1] = publicCoder.decode(publicKey);
      const tr2 = shake256(publicKey, { dkLen: TR_BYTES });
      if (sig.length !== sigCoder.bytesLen)
        return false;
      const [cTilde, z, h] = sigCoder.decode(sig);
      if (h === false)
        return false;
      for (let i = 0; i < L; i++)
        if (polyChknorm(z[i], GAMMA1 - BETA))
          return false;
      const mu = externalMu ? msg : (
        // 7: µ ← H(tr||M, 512)
        shake256.create({ dkLen: CRH_BYTES }).update(tr2).update(msg).digest()
      );
      const c = crystals2.NTT.encode(SampleInBall(cTilde));
      const zNtt = z.map((i) => i.slice());
      for (let i = 0; i < L; i++)
        crystals2.NTT.encode(zNtt[i]);
      const wTick1 = [];
      const xof = XOF1282(rho);
      for (let i = 0; i < K; i++) {
        const ct12d = MultiplyNTTs2(crystals2.NTT.encode(polyShiftl(t1[i])), c);
        const Az = newPoly(N2);
        for (let j = 0; j < L; j++) {
          const aij = RejNTTPoly(xof.get(j, i));
          polyAdd2(Az, MultiplyNTTs2(aij, zNtt[j]));
        }
        const wApprox = crystals2.NTT.decode(polySub2(Az, ct12d));
        wTick1.push(polyUseHint(wApprox, h[i]));
      }
      xof.clean();
      const c2 = shake256.create({ dkLen: C_TILDE_BYTES }).update(mu).update(W1Vec.encode(wTick1)).digest();
      for (const t of h) {
        const sum = t.reduce((acc, i) => acc + i, 0);
        if (!(sum <= OMEGA))
          return false;
      }
      for (const t of z)
        if (polyChknorm(t, GAMMA1 - BETA))
          return false;
      return equalBytes(cTilde, c2);
    }
  });
  return Object.freeze({
    info: Object.freeze({ type: "ml-dsa" }),
    internal,
    securityLevel,
    keygen: internal.keygen,
    lengths: internal.lengths,
    getPublicKey: internal.getPublicKey,
    sign: (msg, secretKey, opts3 = {}) => {
      opts3 = validateSigOpts(opts3);
      const M = getMessage(msg, opts3.context);
      const res = internal.sign(M, secretKey, {
        extraEntropy: opts3.extraEntropy,
        externalMu: false
      });
      cleanBytes(M);
      return res;
    },
    verify: (sig, msg, publicKey, opts3 = {}) => {
      opts3 = validateVerOpts(opts3);
      abytesDoc(sig, void 0, "signature");
      return internal.verify(sig, getMessage(msg, opts3.context), publicKey, { externalMu: false });
    },
    prehash: (hash) => {
      checkHash(hash, securityLevel);
      const rawHash = hash;
      return Object.freeze({
        info: Object.freeze({ type: "hashml-dsa" }),
        securityLevel,
        lengths: internal.lengths,
        keygen: internal.keygen,
        getPublicKey: internal.getPublicKey,
        sign: (msg, secretKey, opts3 = {}) => {
          opts3 = validateSigOpts(opts3);
          const M = getMessagePrehash(rawHash, msg, opts3.context);
          const res = internal.sign(M, secretKey, {
            extraEntropy: opts3.extraEntropy,
            externalMu: false
          });
          cleanBytes(M);
          return res;
        },
        verify: (sig, msg, publicKey, opts3 = {}) => {
          opts3 = validateVerOpts(opts3);
          abytesDoc(sig, void 0, "signature");
          return internal.verify(sig, getMessagePrehash(rawHash, msg, opts3.context), publicKey, {
            externalMu: false
          });
        }
      });
    }
  });
}
var INTERNAL_SIG_OPT_KEYS, INTERNAL_VER_OPT_KEYS, N2, Q2, ROOT_OF_UNITY2, F2, D, GAMMA2_1, GAMMA2_2, PARAMS2, newPoly, crystals2, id, polyCoder2, polyAdd2, polySub2, polyShiftl, polyChknorm, MultiplyNTTs2, ml_dsa44, ml_dsa65, ml_dsa87;
var init_ml_dsa = __esm({
  "node_modules/@noble/post-quantum/ml-dsa.js"() {
    init_utils2();
    init_sha3();
    init_crystals();
    init_utils3();
    INTERNAL_SIG_OPT_KEYS = /* @__PURE__ */ Object.freeze([
      "extraEntropy",
      "externalMu"
    ]);
    INTERNAL_VER_OPT_KEYS = /* @__PURE__ */ Object.freeze(["externalMu"]);
    N2 = 256;
    Q2 = 8380417;
    ROOT_OF_UNITY2 = 1753;
    F2 = 8347681;
    D = 13;
    GAMMA2_1 = Math.floor((Q2 - 1) / 88) | 0;
    GAMMA2_2 = Math.floor((Q2 - 1) / 32) | 0;
    PARAMS2 = /* @__PURE__ */ (() => Object.freeze({
      2: Object.freeze({
        K: 4,
        L: 4,
        D,
        GAMMA1: 2 ** 17,
        GAMMA2: GAMMA2_1,
        TAU: 39,
        ETA: 2,
        OMEGA: 80
      }),
      3: Object.freeze({
        K: 6,
        L: 5,
        D,
        GAMMA1: 2 ** 19,
        GAMMA2: GAMMA2_2,
        TAU: 49,
        ETA: 4,
        OMEGA: 55
      }),
      5: Object.freeze({
        K: 8,
        L: 7,
        D,
        GAMMA1: 2 ** 19,
        GAMMA2: GAMMA2_2,
        TAU: 60,
        ETA: 2,
        OMEGA: 75
      })
    }))();
    newPoly = (n) => new Int32Array(n);
    crystals2 = /* @__PURE__ */ genCrystals({
      N: N2,
      Q: Q2,
      F: F2,
      ROOT_OF_UNITY: ROOT_OF_UNITY2,
      newPoly,
      isKyber: false,
      brvBits: 8
    });
    id = (n) => n;
    polyCoder2 = (d, compress2 = id, verify = id) => crystals2.bitsCoder(d, {
      encode: (i) => compress2(verify(i)),
      decode: (i) => verify(compress2(i))
    });
    polyAdd2 = (a_, b_) => {
      const a = a_;
      const b = b_;
      for (let i = 0; i < a.length; i++)
        a[i] = crystals2.mod(a[i] + b[i]);
      return a;
    };
    polySub2 = (a_, b_) => {
      const a = a_;
      const b = b_;
      for (let i = 0; i < a.length; i++)
        a[i] = crystals2.mod(a[i] - b[i]);
      return a;
    };
    polyShiftl = (p_) => {
      const p = p_;
      for (let i = 0; i < N2; i++)
        p[i] <<= D;
      return p;
    };
    polyChknorm = (p_, B2) => {
      const p = p_;
      for (let i = 0; i < N2; i++)
        if (Math.abs(crystals2.smod(p[i])) >= B2)
          return true;
      return false;
    };
    MultiplyNTTs2 = (a_, b_) => {
      const a = a_;
      const b = b_;
      const c = newPoly(N2);
      for (let i = 0; i < a.length; i++)
        c[i] = crystals2.mod(a[i] * b[i]);
      return c;
    };
    ml_dsa44 = /* @__PURE__ */ (() => getDilithium({
      ...PARAMS2[2],
      CRH_BYTES: 64,
      TR_BYTES: 64,
      C_TILDE_BYTES: 32,
      XOF128,
      XOF256,
      securityLevel: 128
    }))();
    ml_dsa65 = /* @__PURE__ */ (() => getDilithium({
      ...PARAMS2[3],
      CRH_BYTES: 64,
      TR_BYTES: 64,
      C_TILDE_BYTES: 48,
      XOF128,
      XOF256,
      securityLevel: 192
    }))();
    ml_dsa87 = /* @__PURE__ */ (() => getDilithium({
      ...PARAMS2[5],
      CRH_BYTES: 64,
      TR_BYTES: 64,
      C_TILDE_BYTES: 64,
      XOF128,
      XOF256,
      securityLevel: 256
    }))();
  }
});

// src/pqc.cjs
var require_pqc = __commonJS({
  "src/pqc.cjs"(exports2, module2) {
    "use strict";
    var { ml_kem768: kem } = (init_ml_kem(), __toCommonJS(ml_kem_exports));
    var { ml_dsa65: dsa } = (init_ml_dsa(), __toCommonJS(ml_dsa_exports));
    var core2 = require_core();
    var { jsonBytes, parseBytes, randomId, sha } = core2;
    var suite = "homebound-pqc-preview-2";
    var random = (n) => crypto.getRandomValues(new Uint8Array(n));
    var idPattern = /^[a-f0-9]{32}$/;
    function b64(bytes) {
      const a = new Uint8Array(bytes);
      let s = "";
      for (let i = 0; i < a.length; i += 8192) s += String.fromCharCode(...a.subarray(i, i + 8192));
      return btoa(s);
    }
    function un64(s) {
      return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    }
    function check(ok, msg) {
      if (!ok) throw Error(msg);
    }
    function message(domain, fields) {
      return jsonBytes([suite, domain, ...fields]);
    }
    function signed(domain, fields, key) {
      return b64(dsa.sign(message(domain, fields), key));
    }
    function verify(domain, fields, signature, publicKey) {
      check(dsa.verify(un64(signature), message(domain, fields), un64(publicKey)), "\u7B7E\u540D\u9A8C\u8BC1\u5931\u8D25\u3002");
    }
    async function fingerprint(fields) {
      return (await sha(message("fingerprint", fields))).slice(0, 32);
    }
    async function identity(seed, label) {
      check(typeof seed === "string" && un64(seed).length === 32 && b64(un64(seed)) === seed, "\u65E0\u6548\u7684 256 \u4F4D\u79CD\u5B50\u3002");
      const master = await crypto.subtle.importKey("raw", un64(seed), "HKDF", false, ["deriveBits"]);
      const derive = async (purpose, size) => new Uint8Array(await crypto.subtle.deriveBits({
        name: "HKDF",
        hash: "SHA-256",
        salt: jsonBytes(suite),
        info: jsonBytes([label, purpose])
      }, master, size * 8));
      const enc = kem.keygen(await derive("kem", 64)), sig = dsa.keygen(await derive("signature", 32));
      const token = b64(await derive("ledger-capability", 32));
      const pub = { kem: b64(enc.publicKey), sig: b64(sig.publicKey), cap: await sha(new TextEncoder().encode(token)) };
      return { pub, token, id: await fingerprint([pub.kem, pub.sig, pub.cap]), enc: enc.secretKey, sign: sig.secretKey };
    }
    var freshSeed = () => b64(random(32));
    var aes = (raw) => crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
    async function envelope(pub, ring, context) {
      const { sharedSecret, cipherText } = kem.encapsulate(un64(pub.kem));
      const iv = random(12);
      const body = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: message("envelope", context) }, await aes(sharedSecret), jsonBytes(ring));
      return [b64(cipherText), b64(iv), b64(body)];
    }
    async function openRing(pair, wrapped, context) {
      check(wrapped, "\u6B64\u8BBE\u5907\u672A\u83B7\u6388\u6743\uFF0C\u6216\u5DF2\u88AB\u64A4\u9500\u3002");
      const secret = kem.decapsulate(un64(wrapped[0]), pair.enc);
      return parseBytes(await crypto.subtle.decrypt({ name: "AES-GCM", iv: un64(wrapped[1]), additionalData: message("envelope", context) }, await aes(secret), un64(wrapped[2])));
    }
    var digestOf = (text) => sha(new TextEncoder().encode(text));
    var publicId = (pub) => fingerprint([pub.kem, pub.sig, pub.cap]);
    var latest = (state2) => state2.policies.at(-1);
    function publicDevice(device, name) {
      check(typeof name === "string" && name.trim() && name.length <= 64, "\u8BF7\u8F93\u5165\u8BBE\u5907\u540D\u79F0\uFF081 \u81F3 64 \u5B57\uFF09\u3002");
      return { ...device.pub, name: name.trim() };
    }
    async function state(ledger, anchor, pin, withRevisions = true) {
      check(idPattern.test(anchor), "\u5E93\u6307\u7EB9\u65E0\u6548\u3002");
      const nonce = randomId(), snapshot = await ledger("state", { anchor, nonce, withRevisions });
      check(snapshot.nonce === nonce && snapshot.policies.length > 0, "\u53EF\u4FE1\u63D0\u4EA4\u670D\u52A1\u672A\u63D0\u4F9B\u5F53\u524D\u72B6\u6001\u3002");
      const policies = [];
      let linked = false;
      for (const raw of snapshot.policies) {
        const { policy: p, sig } = JSON.parse(raw), prev = policies.at(-1);
        check(p.suite === suite && p.n === policies.length && p.anchor === anchor && p.parent === (prev?.digest || ""), "\u6388\u6743\u94FE\u4E0D\u5339\u914D\u3002");
        if (!prev) check(await publicId(p.recovery) === anchor && p.by === "recovery", "\u521D\u59CB\u6062\u590D\u8EAB\u4EFD\u4E0D\u5339\u914D\u3002");
        const prior = prev?.p || p;
        check(p.by === "recovery" || p.by === prior.admin, "\u65E0\u7BA1\u7406\u6743\u9650\u3002");
        verify("policy", [p], sig, p.by === "recovery" ? prior.recovery.sig : prior.members[prior.admin].sig);
        check(p.members[p.admin] && (p.by === "recovery" || JSON.stringify(p.recovery) === JSON.stringify(prior.recovery)), "\u65E0\u6548\u6062\u590D\u6839\u3002");
        if (p.keyLink !== void 0) {
          check(prev && typeof p.keyLink === "string" && un64(p.keyLink).length === 60, "\u5386\u53F2\u5BC6\u94A5\u94FE\u63A5\u635F\u574F\u3002");
          linked = true;
        } else check(!linked, "\u5386\u53F2\u5BC6\u94A5\u683C\u5F0F\u53D1\u751F\u56DE\u9000\u3002");
        const digest = await digestOf(raw);
        if (pin?.n === p.n) check(pin.digest === digest, "\u6388\u6743\u8BB0\u5F55\u5DF2\u88AB\u66FF\u6362\u3002");
        policies.push({ p, digest });
      }
      check(!pin || pin.n < policies.length, "\u6388\u6743\u8BB0\u5F55\u56DE\u9000\u3002");
      return { policies, rows: snapshot.revisions };
    }
    async function signPolicy(ledger, p, actor, keys, token = actor.token) {
      p.boxes = {};
      for (const [id2, m] of Object.entries(p.members)) p.boxes[id2] = await envelope(m, keys, [p.anchor, p.n, id2]);
      p.recoveryBox = await envelope(p.recovery, keys, [p.anchor, p.n, "recovery"]);
      const row = JSON.stringify({ policy: p, sig: signed("policy", [p], actor.sign) });
      const result = await ledger("policy", { head: p.parent, row }, token);
      check(result.digest === await digestOf(row), "\u63D0\u4EA4\u670D\u52A1\u8FD4\u56DE\u4E86\u4E0D\u540C\u7684\u6388\u6743\u6458\u8981\u3002");
      return { p, digest: result.digest };
    }
    async function genesis(ledger, device, name, recovery, bootstrap) {
      const p = { suite, n: 0, parent: "", by: "recovery", anchor: recovery.id, recovery: recovery.pub, admin: device.id, members: { [device.id]: publicDevice(device, name) } };
      await signPolicy(ledger, p, recovery, [freshSeed()], bootstrap);
    }
    var lifetime = 10 * 60 * 1e3;
    async function requestPair(dav, s, device, name) {
      const { p, digest } = latest(s), pub = publicDevice(device, name);
      const request = { anchor: p.anchor, head: digest, nonce: randomId(), expires: Date.now() + lifetime, pub };
      const code = await fingerprint([request]);
      await dav.child("requests").put(code, jsonBytes({ request, sig: signed("join", [request], device.sign) }).buffer);
      return code;
    }
    async function readRequest(dav, s, code) {
      check(idPattern.test(code), "\u914D\u5BF9\u7801\u683C\u5F0F\u9519\u8BEF\u3002");
      const { request, sig } = parseBytes(await dav.child("requests").read(code));
      const { p, digest } = latest(s);
      check(request.anchor === p.anchor && request.head === digest, "\u914D\u5BF9\u7533\u8BF7\u5DF2\u8FC7\u671F\u6216\u5DF2\u4F7F\u7528\u3002");
      check(Number.isSafeInteger(request.expires) && request.expires >= Date.now() && request.expires <= Date.now() + lifetime + 6e4, "\u914D\u5BF9\u7533\u8BF7\u5DF2\u8FC7\u671F\u3002");
      check(idPattern.test(request.nonce) && await fingerprint([request]) === code, "\u914D\u5BF9\u7801\u88AB\u66FF\u6362\u3002");
      verify("join", [request], sig, request.pub.sig);
      return { id: await publicId(request.pub), pub: request.pub, expires: request.expires, head: digest };
    }
    async function nextPolicy(ledger, s, actor, action, arg) {
      const { p, digest } = latest(s), restoring = action === "restore";
      const recoveryId = await publicId(p.recovery);
      check(restoring ? actor.id === recoveryId : actor.id === p.admin, "\u6062\u590D\u8EAB\u4EFD\u6216\u7BA1\u7406\u5458\u4E0D\u5339\u914D\u3002");
      const keys = await openRing(actor, restoring ? p.recoveryBox : p.boxes[actor.id], [p.anchor, p.n, restoring ? "recovery" : actor.id]);
      check(keys.length === (p.keyLink ? 1 : p.n + 1), "\u5F53\u524D\u4EE3\u5BC6\u94A5\u8BB0\u5F55\u4E0D\u5B8C\u6574\u3002");
      let members = { ...p.members }, admin = p.admin, recovery = p.recovery;
      if (restoring) {
        check(arg.id !== p.admin && !members[arg.id] && await publicId(arg.recovery) !== recoveryId, "\u8BF7\u751F\u6210\u65B0\u7684\u8BBE\u5907\u8EAB\u4EFD\u548C\u6062\u590D\u7801\u3002");
        members = { [arg.id]: arg.pub };
        admin = arg.id;
        recovery = arg.recovery;
      } else if (action === "revoke") {
        check(arg !== admin && members[arg], "\u65E0\u6CD5\u64A4\u9500\u8BE5\u8BBE\u5907\u3002");
        delete members[arg];
      } else if (action === "approve") {
        check(!members[arg.id] && arg.expires >= Date.now() && arg.head === digest, "\u914D\u5BF9\u7533\u8BF7\u5931\u6548\u3002");
        members[arg.id] = arg.pub;
      } else check(action === "seal-history", "\u672A\u77E5\u64CD\u4F5C\u3002");
      const next = { suite, n: p.n + 1, parent: digest, anchor: p.anchor, by: restoring ? "recovery" : actor.id, recovery, admin, members };
      const current = freshSeed();
      next.keyLink = b64(await encrypt(un64(current), [suite, p.anchor, next.n, digest, "previous-key"], un64(keys.at(-1))));
      if (!p.keyLink && p.n > 0) {
        next.legacyKeys = b64(await encrypt(un64(current), [suite, p.anchor, next.n, digest, "legacy-keys"], jsonBytes(keys.slice(0, -1))));
      }
      return signPolicy(ledger, next, actor, [current]);
    }
    async function encrypt(rawKey, label, bytes) {
      const iv = random(12), cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: jsonBytes(label) }, await aes(rawKey), bytes);
      const packet = new Uint8Array(12 + cipher.byteLength);
      packet.set(iv);
      packet.set(new Uint8Array(cipher), 12);
      return packet;
    }
    async function decrypt(rawKey, label, packet) {
      const a = new Uint8Array(packet);
      return crypto.subtle.decrypt({ name: "AES-GCM", iv: a.subarray(0, 12), additionalData: jsonBytes(label) }, await aes(rawKey), a.subarray(12));
    }
    function validateGraph(revisions) {
      const seen = /* @__PURE__ */ new Map();
      for (const r of revisions) {
        check(idPattern.test(r.id) && !seen.has(r.id) && core2.safePath(r.path) && !core2.isRecovery(r.path), "\u65E0\u6548\u7684\u4FEE\u8BA2\u6216\u8DEF\u5F84\u3002");
        if (!Array.isArray(r.parents) || new Set(r.parents).size !== r.parents.length || !r.parents.every((id2) => seen.get(id2)?.path === r.path)) {
          throw Object.assign(Error("\u4FEE\u8BA2\u56FE\u7F3A\u5C11\u7236\u9879\u3001\u542B\u73AF\u6216\u8DEF\u5F84\u4E0D\u4E00\u81F4\uFF1A" + r.path + " [" + r.id + "]"), { path: r.path, id: r.id });
        }
        check(r.hash === null || /^[a-f0-9]{64}$/.test(r.hash), "\u65E0\u6548\u7684\u6B63\u6587\u6458\u8981\u3002");
        seen.set(r.id, r);
      }
      return seen;
    }
    async function storeFor(ledger, dav, s, device) {
      const { p, digest } = latest(s);
      const envelopeKeys = await openRing(device, p.boxes[device.id], [p.anchor, p.n, device.id]);
      let ring = envelopeKeys;
      if (p.keyLink) {
        check(envelopeKeys.length === 1, "\u5F53\u524D\u4EE3\u5BC6\u94A5\u8BB0\u5F55\u4E0D\u5B8C\u6574\u3002");
        ring = new Array(p.n + 1);
        let n = p.n;
        ring[n] = envelopeKeys[0];
        while (n > 0 && s.policies[n].p.keyLink) {
          const policy = s.policies[n].p;
          const previous = await decrypt(un64(ring[n]), [suite, p.anchor, n, policy.parent, "previous-key"], un64(policy.keyLink));
          ring[--n] = b64(previous);
        }
        if (n > 0) {
          const bridge = s.policies[n + 1].p.legacyKeys;
          check(typeof bridge === "string", "\u7F3A\u5C11\u65E7\u7248\u5386\u53F2\u5BC6\u94A5\u3002");
          const legacy = parseBytes(await decrypt(un64(ring[n + 1]), [suite, p.anchor, n + 1, s.policies[n].digest, "legacy-keys"], un64(bridge)));
          check(legacy.length === n && legacy.every((k) => typeof k === "string" && un64(k).length === 32), "\u65E7\u7248\u5BC6\u94A5\u8BB0\u5F55\u4E0D\u5B8C\u6574\u3002");
          for (let i = 0; i < n; i++) ring[i] = legacy[i];
        }
      }
      check(ring.length === s.policies.length, "\u5BC6\u94A5\u8BB0\u5F55\u4E0D\u5B8C\u6574\u3002");
      const bodies = dav.child("objects"), revisions = [];
      let previousEpoch = -1;
      for (const raw of s.rows) {
        const { record: r, sig } = JSON.parse(raw), policy = s.policies[r.epoch];
        check(policy && r.anchor === p.anchor && r.head === policy.digest && r.epoch >= previousEpoch && policy.p.members[r.from], "\u975E\u6CD5\u5199\u5165\u4EE3\u9645\u6216\u4F5C\u8005\u3002");
        verify("revision", [r], sig, policy.p.members[r.from].sig);
        const rev = parseBytes(await decrypt(un64(ring[r.epoch]), [suite, p.anchor, r.epoch, r.id, "manifest"], un64(r.payload)));
        check(rev.id === r.id && (rev.hash === null ? rev.key === null : typeof rev.key === "string" && un64(rev.key).length === 32), "\u4FEE\u8BA2\u8BB0\u5F55\u5F02\u5E38\u3002");
        revisions.push(rev);
        previousEpoch = r.epoch;
      }
      const history = validateGraph(revisions);
      return {
        async history() {
          return new Map(history);
        },
        async readBody(rev) {
          const body = await decrypt(un64(rev.key), [suite, p.anchor, rev.id, "body"], await bodies.read(rev.id));
          check(await sha(body) === rev.hash, "\u6B63\u6587\u6821\u9A8C\u5931\u8D25\u3002");
          return body;
        },
        async publish(path, parents, bytes) {
          const id2 = randomId(), contentKey = bytes === null ? null : random(32);
          const rev = { id: id2, path, parents, hash: bytes === null ? null : await sha(bytes), key: contentKey ? b64(contentKey) : null };
          validateGraph([...history.values(), rev]);
          if (contentKey) await bodies.put(id2, (await encrypt(contentKey, [suite, p.anchor, id2, "body"], bytes)).buffer);
          const r = {
            anchor: p.anchor,
            head: digest,
            epoch: p.n,
            id: id2,
            from: device.id,
            payload: b64(await encrypt(un64(ring[p.n]), [suite, p.anchor, p.n, id2, "manifest"], jsonBytes(rev)))
          };
          const row = JSON.stringify({ record: r, sig: signed("revision", [r], device.sign) });
          const receipt = await ledger("commit", { head: digest, row }, device.token);
          check(receipt.digest === await digestOf(row), "\u5199\u5165\u56DE\u6267\u65E0\u6548\u3002");
          history.set(id2, rev);
          return rev;
        }
      };
    }
    async function auditData(store) {
      const history = await store.history(), faults = [];
      for (const rev of history.values()) if (rev.hash !== null) {
        try {
          await store.readBody(rev);
        } catch {
          faults.push({ id: rev.id, path: rev.path });
        }
      }
      return { checked: history.size, faults };
    }
    module2.exports = { identity, freshSeed, publicDevice, publicId, genesis, state, latest, requestPair, readRequest, nextPolicy, storeFor, auditData, validateGraph };
  }
});

// src/pqc-mode.cjs
var require_pqc_mode = __commonJS({
  "src/pqc-mode.cjs"(exports2, module2) {
    "use strict";
    var { Setting: Setting2, Modal: Modal2, Notice: Notice2, requestUrl: requestUrl2 } = require("obsidian");
    var core2 = require_core();
    var pq = require_pqc();
    var { Dav: Dav2, VaultFiles: VaultFiles2, credentials: credentials2 } = require_adapter();
    var folder = "Homebound-PQC";
    var namespace2 = "pqc-preview-2";
    var notice = (e) => new Notice2(e.message || String(e), 1e4);
    var Output = class extends Modal2 {
      constructor(app, title, value) {
        super(app);
        this.title = title;
        this.value = value;
      }
      onOpen() {
        this.setTitle(this.title);
        const t = this.contentEl.createEl("textarea");
        t.readOnly = true;
        t.value = this.value;
        t.rows = 4;
        t.style.width = "100%";
        new Setting2(this.contentEl).addButton((b) => b.setButtonText("\u590D\u5236").onClick(() => navigator.clipboard.writeText(this.value).catch(notice)));
      }
      onClose() {
        this.value = "";
        this.contentEl.empty();
      }
    };
    function displaySettings(el, p, app, redraw) {
      const c = { ...p.config };
      let password = "", code = "", request = "", recovery = "", bootstrap = "";
      const field = (label, value, change, secret = false) => new Setting2(el).setName(label).addText((t) => {
        t.setValue(value).onChange(change);
        if (secret) t.inputEl.type = "password";
      });
      const button = (label, fn) => new Setting2(el).addButton((b) => b.setButtonText(label).onClick(async () => {
        try {
          const result = await p.exclusive(fn);
          redraw();
          if (result?.title) new Output(app, result.title, result.value).open();
        } catch (e) {
          redraw();
          notice(e);
        }
      }));
      el.createEl("p", { text: "PQC \u8FDC\u7AEF\u76EE\u5F55\uFF1A" + folder });
      field("\u5C40\u57DF\u7F51 WebDAV \u5730\u5740", c.home, (v) => c.home = v);
      field("\u5916\u7F51 WebDAV \u5730\u5740", c.away, (v) => c.away = v);
      field("\u53EF\u4FE1\u63D0\u4EA4\u670D\u52A1 HTTPS \u5730\u5740", c.witness, (v) => c.witness = v);
      field("WebDAV \u7528\u6237\u540D", c.username, (v) => c.username = v);
      field("WebDAV \u5BC6\u7801\uFF08\u7559\u7A7A\u6CBF\u7528\uFF09", "", (v) => password = v, true);
      field("\u8FD9\u53F0\u8BBE\u5907\u7684\u540D\u79F0", c.name, (v) => c.name = v);
      button("\u4FDD\u5B58\u8FDE\u63A5\u8BBE\u7F6E", () => p.configure(c, password));
      if (p.config.anchor) el.createEl("p", { text: "\u5E93\u6307\u7EB9\uFF1A" + p.config.anchor });
      if (!p.config.anchor) {
        field("\u5EFA\u5E93\u6388\u6743\uFF08\u670D\u52A1\u90E8\u7F72\u8005\u63D0\u4F9B\uFF09", "", (v) => bootstrap = v, true);
        button("\u5728\u5C40\u57DF\u7F51\u521B\u5EFA PQC \u5E93", async () => {
          const seed = pq.freshSeed();
          const out = new Output(app, "\u5148\u79BB\u7EBF\u4FDD\u5B58\u6062\u590D\u7801\uFF0C\u7136\u540E\u786E\u8BA4\u521B\u5EFA", seed);
          const previous = out.onOpen.bind(out);
          out.onOpen = () => {
            previous();
            new Setting2(out.contentEl).addButton((b) => b.setButtonText("\u6211\u5DF2\u4FDD\u5B58\uFF0C\u521B\u5EFA").onClick(async () => {
              try {
                await p.exclusive(() => p.create(seed, bootstrap));
                out.close();
                redraw();
              } catch (e) {
                notice(e);
              }
            }));
          };
          out.open();
        });
        field("\u4ECE\u7BA1\u7406\u5458 Mac \u6838\u5BF9\u7684\u5E93\u6307\u7EB9", "", (v) => code = v);
        button("\u7533\u8BF7\u914D\u5BF9", async () => ({ title: "\u8BF7\u5728\u7BA1\u7406\u5458 Mac \u8F93\u5165\u6B64\u914D\u5BF9\u7801", value: await p.request(code.trim()) }));
      }
      if (p.config.request) {
        el.createEl("p", { text: "\u672C\u8BBE\u5907\u914D\u5BF9\u7801\uFF0810 \u5206\u949F\u6709\u6548\uFF09\uFF1A" + p.config.request });
      }
      if (p.config.anchor && !p.config.admin) {
        button("\u91CD\u65B0\u7533\u8BF7\u914D\u5BF9", async () => ({ title: "\u65B0\u914D\u5BF9\u7801", value: await p.request(p.config.anchor) }));
      }
      if (p.config.integrity) el.createEl("p", { text: p.config.integrity });
      if (p.config.anchor) {
        button("\u7ACB\u5373\u540C\u6B65 / \u68C0\u67E5\u914D\u5BF9", async () => {
          const r = await p.sync();
          new Notice2(r.route + " \xB7 \u4E0A\u4F20 " + r.sent + " \xB7 \u4E0B\u8F7D " + r.received);
        });
        if (p.config.admin) {
          button("\u91CD\u65B0\u6821\u9A8C\u6062\u590D\u6570\u636E", () => p.verifyRecovery());
          field("\u65B0\u8BBE\u5907\u663E\u793A\u7684\u914D\u5BF9\u7801", "", (v) => request = v);
          button("\u6279\u51C6\u5DF2\u6838\u5BF9\u7684\u914D\u5BF9\u7801", () => p.approve(request.trim()));
          for (const member of p.config.others || []) button("\u64A4\u9500\u8BBE\u5907 \xB7 " + member.name + " \xB7 " + member.id.slice(-8), async () => {
            const modal = new Modal2(app);
            modal.setTitle("\u64A4\u9500 " + member.name + " \u5E76\u8F6E\u6362\u5E93\u5BC6\u94A5\uFF1F");
            new Setting2(modal.contentEl).addButton((b) => b.setButtonText("\u786E\u8BA4\u64A4\u9500").onClick(async () => {
              try {
                await p.exclusive(() => p.revoke(member.id));
                modal.close();
                redraw();
              } catch (e) {
                notice(e);
              }
            }));
            modal.open();
          });
        }
      }
      field("\u79BB\u7EBF\u6062\u590D\u7801", "", (v) => recovery = v, true);
      button("\u7528\u6062\u590D\u7801\u63A5\u7BA1\uFF0C\u64A4\u9500\u539F\u8BBE\u5907", async () => {
        const saved = p.pendingRecovery(), replacement = saved || pq.freshSeed();
        const kit = await p.replacementKit(recovery.trim(), replacement);
        const modal = new Output(app, "\u5148\u79BB\u7EBF\u4FDD\u5B58\u65B0\u6062\u590D\u7801\u3002\u786E\u8BA4\u540E\u65E7\u7801\u3001\u539F\u8BBE\u5907\u5747\u4F1A\u5931\u6548\u3002", kit);
        const open = modal.onOpen.bind(modal);
        modal.onOpen = () => {
          open();
          new Setting2(modal.contentEl).addButton((b) => b.setButtonText("\u786E\u8BA4\u6062\u590D").onClick(async () => {
            try {
              await p.exclusive(() => p.restore(recovery.trim(), replacement));
              modal.close();
              redraw();
            } catch (e) {
              notice(e);
            }
          }));
        };
        modal.open();
      });
    }
    var PqcMode2 = class {
      constructor(app) {
        this.app = app;
        const saved = app.loadLocalStorage("homebound-webdav-pqc-config");
        if (saved && saved.format !== 2) throw Error("\u65E0\u6CD5\u8BC6\u522B\u6B64\u8BBE\u5907\u7684 PQC \u914D\u7F6E\u3002");
        this.config = { format: 2, home: "", away: "", witness: "", username: "", name: "\u6211\u7684\u8BBE\u5907", ...saved };
        if (!this.config.local) {
          this.config.local = core2.randomId();
          this.saveData(this.config);
        }
      }
      saveData(data) {
        this.app.saveLocalStorage("homebound-webdav-pqc-config", data);
      }
      display(el, redraw) {
        displaySettings(el, this, this.app, redraw);
      }
      async exclusive(fn) {
        if (this.closed) throw Error("PQC \u6A21\u5F0F\u5DF2\u5173\u95ED\u3002");
        if (this.busy) throw Error("\u64CD\u4F5C\u8FDB\u884C\u4E2D\u3002");
        this.busy = true;
        try {
          return await fn();
        } finally {
          this.busy = false;
        }
      }
      secret(k, v) {
        const s = this.app.secretStorage, id2 = "hbpqc-" + this.config.local + "-" + k;
        if (v !== void 0) s.setSecret(id2, v);
        return s.getSecret(id2);
      }
      async configure(c, password) {
        const home = core2.endpoint(c.home), away = c.away ? core2.endpoint(c.away) : "";
        const witness = core2.endpoint(c.witness);
        if (!witness.startsWith("https://") || this.config.anchor && this.config.witness !== witness) throw Error("\u53EF\u4FE1\u63D0\u4EA4\u670D\u52A1\u9700\u4F7F\u7528\u5EFA\u5E93\u65F6\u6838\u5BF9\u7684 HTTPS \u5730\u5740\u3002");
        Object.assign(this.config, { home, away, witness, name: c.name.trim(), username: c.username.trim() });
        if (password) this.secret("dav", password);
        await this.saveData(this.config);
      }
      async device() {
        if (!this.keys) {
          let seed = this.secret("device");
          if (!seed) {
            seed = pq.freshSeed();
            this.secret("device", seed);
          }
          this.keys = await pq.identity(seed, "device");
        }
        return this.keys;
      }
      base(url) {
        return new Dav2(core2.endpoint(url), credentials2(this.config.username, this.secret("dav")));
      }
      async route() {
        const c = this.config;
        for (const [i, url] of [c.home, c.away].entries()) {
          const dav = this.base(url).child(folder).child(namespace2);
          let timer;
          try {
            await Promise.race([dav.read("vault.json"), new Promise((_, reject) => {
              timer = setTimeout(() => reject(Object.assign(Error("\u8FDE\u63A5\u8D85\u65F6"), { offline: true })), i === 0 && c.away ? 3e3 : 16e3);
            })]);
            return { dav, route: i ? "VPS/VPN" : "LAN" };
          } catch (e) {
            if (i || !e.offline || !c.away) throw e;
          } finally {
            clearTimeout(timer);
          }
        }
      }
      async create(seed, bootstrap) {
        const rec = await pq.identity(seed, "recovery"), dev = await this.device(), home = this.base(this.config.home), dir = home.child(folder);
        try {
          await home.mkdir(folder);
        } catch (e) {
          if (e.status !== 405) throw e;
        }
        const known = await dir.list();
        if (known.some((x) => x !== namespace2)) throw Error("\u65B0\u6D4B\u8BD5\u76EE\u5F55\u5305\u542B\u5176\u4ED6\u6587\u4EF6\u3002");
        const dav = dir.child(namespace2);
        if (!known.length) await dir.mkdir(namespace2);
        for (const name of ["objects", "requests"]) try {
          await dav.mkdir(name);
        } catch (e) {
          if (e.status !== 405) throw e;
        }
        let live;
        try {
          live = await pq.state(this.ledger.bind(this), rec.id);
        } catch (e) {
          if (e.status !== 404) throw e;
        }
        if (live) {
          if (live.policies.length !== 1 || pq.latest(live).p.admin !== dev.id) throw Error("\u670D\u52A1\u5DF2\u7ED1\u5B9A\u5230\u53E6\u4E00\u7BA1\u7406\u5458\u3002");
        } else await pq.genesis(this.ledger.bind(this), dev, this.config.name, rec, bootstrap);
        await dav.put("vault.json", core2.jsonBytes({ format: 2, anchor: rec.id }).buffer);
        this.config.anchor = rec.id;
        await this.refresh();
        return rec.id;
      }
      async ledger(method, data, token) {
        const nonce = core2.randomId(), headers = { "Cache-Control": "no-store" };
        if (token) headers.Authorization = "Bearer " + token;
        const response = await requestUrl2({
          url: this.config.witness + "/" + method,
          method: "POST",
          headers,
          contentType: "application/json",
          body: JSON.stringify({ ...data, transportNonce: nonce }),
          throw: false
        });
        if (response.status !== 200) {
          const msg = { 403: "\u672A\u83B7\u6388\u6743\u3001\u5DF2\u64A4\u9500\u6216\u6062\u590D\u7801\u5931\u6548", 404: "\u8BF7\u6C42\u4E0D\u5B58\u5728", 409: "\u6388\u6743\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u540C\u6B65\u6216\u914D\u5BF9" }[response.status] || "\u53EF\u4FE1\u63D0\u4EA4\u670D\u52A1\u4E0D\u53EF\u7528";
          throw Object.assign(Error(msg + " (" + response.status + ")"), { status: response.status });
        }
        return response.json;
      }
      async snapshot(anchor = this.config.anchor, withRevisions = true) {
        return pq.state(this.ledger.bind(this), anchor, this.config.pin, withRevisions);
      }
      async context(anchor = this.config.anchor) {
        const [s, r] = await Promise.all([this.snapshot(anchor), this.route()]);
        const marker = core2.parseBytes(await r.dav.read("vault.json"));
        if (marker.format !== 2 || marker.anchor !== anchor) throw Error("WebDAV \u6307\u5411\u53E6\u4E00\u6D4B\u8BD5\u5E93\u3002");
        return { ...r, s, device: await this.device() };
      }
      async refresh(snapshot) {
        const s = snapshot || await this.snapshot(this.config.anchor, false), dev = await this.device(), { p, digest } = pq.latest(s);
        this.config.pin = { n: p.n, digest };
        this.config.admin = p.admin === dev.id;
        this.config.others = Object.entries(p.members).filter(([id2]) => id2 !== dev.id).map(([id2, m]) => ({ id: id2, name: m.name }));
        if (p.members[dev.id]) delete this.config.request;
        await this.saveData(this.config);
      }
      async request(anchor) {
        if (this.config.anchor && this.config.anchor !== anchor) throw Error("\u5E93\u6307\u7EB9\u4E0D\u5339\u914D\u3002");
        const { dav, s, device } = await this.context(anchor);
        if (pq.latest(s).p.members[device.id]) throw Error("\u8FD9\u53F0\u8BBE\u5907\u5DF2\u83B7\u6388\u6743\uFF0C\u53EF\u4EE5\u76F4\u63A5\u540C\u6B65\u3002");
        const code = await pq.requestPair(dav, s, device, this.config.name);
        Object.assign(this.config, { anchor, request: code });
        await this.refresh();
        return code;
      }
      async approve(code) {
        const { dav, s, device } = await this.context();
        const target = await pq.readRequest(dav, s, code);
        await pq.nextPolicy(this.ledger.bind(this), s, device, "approve", target);
        await this.refresh();
        return target.id;
      }
      async sealHistory() {
        await this.change("seal-history");
      }
      async revoke(id2) {
        await this.change("revoke", id2);
      }
      async change(action, arg) {
        await pq.nextPolicy(this.ledger.bind(this), await this.snapshot(this.config.anchor, false), await this.device(), action, arg);
        await this.refresh();
      }
      pendingRecovery() {
        return this.secret("pending-root") || "";
      }
      async recoveryKit(input) {
        const fields = input.split(".");
        if (fields.length > 2) throw Error("\u65E0\u6548\u7684\u6062\u590D\u5305\u3002");
        const rec = await pq.identity(fields.at(-1), "recovery");
        const anchor = fields.length === 1 ? rec.id : fields[0];
        if (!/^[a-f0-9]{32}$/.test(anchor) || this.config.anchor && this.config.anchor !== anchor) throw Error("\u6062\u590D\u8EAB\u4EFD\u4E0E\u672C\u5E93\u4E0D\u7B26\u3002");
        return { anchor, rec };
      }
      async replacementKit(input, seed) {
        const { anchor } = await this.recoveryKit(input);
        return anchor + "." + seed;
      }
      async restore(input, replacement) {
        const { rec, anchor } = await this.recoveryKit(input), s = await this.snapshot(anchor, false);
        if (!replacement || replacement === input.split(".").at(-1)) throw Error("\u8BF7\u79BB\u7EBF\u4FDD\u5B58\u65B0\u7684\u968F\u673A\u6062\u590D\u7801\u3002");
        const newRoot = await pq.identity(replacement, "recovery");
        const existing = this.pendingRecovery(), pending = this.secret("pending-device");
        const resume = existing === replacement && pending && await pq.publicId(pq.latest(s).p.recovery) === newRoot.id;
        if (!resume && await pq.publicId(pq.latest(s).p.recovery) !== rec.id) throw Error("\u6062\u590D\u8EAB\u4EFD\u5DF2\u5931\u6548\u3002");
        const seed = existing === replacement && pending || pq.freshSeed();
        const dev = await pq.identity(seed, "device");
        this.secret("pending-device", seed);
        this.secret("pending-root", replacement);
        if (!resume) {
          await pq.nextPolicy(this.ledger.bind(this), s, rec, "restore", { id: dev.id, pub: pq.publicDevice(dev, this.config.name), recovery: newRoot.pub });
        } else if (pq.latest(s).p.admin !== dev.id) throw Error("\u6062\u590D\u4E8B\u52A1\u4E0E\u5F53\u524D\u7BA1\u7406\u5458\u4E0D\u7B26\u3002");
        this.secret("device", seed);
        this.keys = dev;
        this.config.anchor = anchor;
        this.config.integrity = "\u7BA1\u7406\u5458\u5DF2\u63A5\u7BA1\uFF0C\u5C1A\u672A\u5B8C\u6210\u6570\u636E\u6821\u9A8C\u3002";
        await this.refresh();
        this.secret("pending-root", "");
        this.secret("pending-device", "");
        return this.verifyRecovery();
      }
      async verifyRecovery() {
        let report;
        try {
          const { s, dav, device } = await this.context();
          const store = await pq.storeFor(this.ledger.bind(this), dav, s, device);
          report = await pq.auditData(store);
          this.config.integrity = report.faults.length ? "\u5DF2\u63A5\u7BA1\uFF0C\u6570\u636E\u4E0D\u5B8C\u6574\uFF1A" + report.faults.map((f) => f.path + " [" + f.id + "]").join("\uFF0C") : "\u5DF2\u6821\u9A8C " + report.checked + " \u6761\u5386\u53F2\u4FEE\u8BA2\u53CA\u5BF9\u5E94\u6B63\u6587\u3002";
        } catch (e) {
          this.config.integrity = "\u5DF2\u63A5\u7BA1\uFF0C\u6570\u636E\u6821\u9A8C\u5931\u8D25\uFF1A" + e.message;
          report = { faults: [{ path: e.path, id: e.id, error: e.message }] };
        }
        await this.saveData(this.config);
        return report;
      }
      async sync() {
        const { dav, device, s, route } = await this.context(), last = pq.latest(s);
        if (!last.p.members[device.id]) {
          await this.refresh(s);
          throw Error("\u6B64\u8BBE\u5907\u672A\u83B7\u6388\u6743\uFF0C\u6216\u5DF2\u88AB\u64A4\u9500\u3002\u8BF7\u5728\u8BBE\u7F6E\u4E2D\u91CD\u65B0\u7533\u8BF7\u914D\u5BF9\u3002");
        }
        const store = await pq.storeFor(this.ledger.bind(this), dav, s, device);
        this.config.pin = { n: last.p.n, digest: last.digest };
        delete this.config.request;
        await this.saveData(this.config);
        const id2 = "hbpqc-baseline-" + this.config.anchor;
        const r = await core2.synchronize({
          store,
          local: new VaultFiles2(this.app),
          baseline: new Map(this.app.loadLocalStorage(id2) || []),
          cache: /* @__PURE__ */ new Map(),
          checkpoint: (m) => this.app.saveLocalStorage(id2, [...m]),
          active: () => !this.closed
        });
        return { route, sent: r.sent, received: r.received, conflicts: r.conflicts };
      }
    };
    module2.exports = PqcMode2;
  }
});

// src/plugin.cjs
var { Plugin, PluginSettingTab, Setting, Modal, Notice, TFile, TFolder, requestUrl, getLanguage } = require("obsidian");
var core = require_core();
var tr = (en, zh) => getLanguage().startsWith("zh") ? zh : en;
var namespace = "homebound-v1";
var { Dav, VaultFiles, credentials } = require_adapter();
var PqcMode = require_pqc_mode();
var modeKey = "homebound-webdav-mode";
async function probe(dav, milliseconds) {
  let timer;
  try {
    return await Promise.race([dav.read("vault.json").then(core.parseBytes), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(Error("WebDAV connection timed out."), { offline: true })), milliseconds);
    })]);
  } finally {
    clearTimeout(timer);
  }
}
async function connect(config, password, passphrase) {
  const auth = credentials(config.username, password);
  const addresses = [[config.home, "LAN"]];
  if (config.away && config.away !== config.home) addresses.push([config.away, "VPS/VPN"]);
  for (const [index, [address, route]] of addresses.entries()) {
    const dav = new Dav(address, auth).child(config.folder).child(namespace);
    let header;
    try {
      header = await probe(dav, index === 0 && addresses.length > 1 ? 2500 : 15e3);
    } catch (error) {
      if (error.offline && index + 1 < addresses.length) continue;
      throw error;
    }
    const key = await core.unlock(header, passphrase, config.id);
    return { store: new core.Store(dav, header.id, key), route };
  }
}
var ConfirmFolder = class extends Modal {
  constructor(app, config, create, done) {
    super(app);
    Object.assign(this, { config, create, done });
  }
  onOpen() {
    this.setTitle(this.create ? tr("Create encrypted vault?", "\u521B\u5EFA\u52A0\u5BC6\u5E93\uFF1F") : tr("Use this remote folder?", "\u4F7F\u7528\u8FD9\u4E2A\u8FDC\u7AEF\u76EE\u5F55\uFF1F"));
    this.contentEl.createEl("p", { text: this.config.home + "/" + core.encodePath(this.config.folder) });
    if (this.config.away) this.contentEl.createEl("p", { text: this.config.away + "/" + core.encodePath(this.config.folder) });
    this.contentEl.createEl("p", { text: this.create ? tr("Creates a new encrypted vault in an empty folder using the LAN address.", "\u901A\u8FC7\u5C40\u57DF\u7F51\u5730\u5740\uFF0C\u5728\u7A7A\u76EE\u5F55\u4E2D\u521B\u5EFA\u65B0\u52A0\u5BC6\u5E93\u3002") : tr("Verifies the passphrase and saves this vault on this device.", "\u9A8C\u8BC1\u52A0\u5BC6\u53E3\u4EE4\u540E\uFF0C\u5C06\u8FD9\u4E2A\u5E93\u7ED1\u5B9A\u5230\u5F53\u524D\u8BBE\u5907\u3002") });
    new Setting(this.contentEl).addButton((b) => b.setButtonText(tr("Cancel", "\u53D6\u6D88")).onClick(() => this.close())).addButton((b) => b.setCta().setButtonText(tr("Confirm", "\u786E\u8BA4")).onClick(() => {
      this.close();
      this.done();
    }));
  }
  onClose() {
    this.contentEl.empty();
  }
};
var HomeboundSettings = class extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const p = this.plugin, el = this.containerEl;
    el.empty();
    el.addClass("homebound-settings");
    new Setting(el).setName(tr("Sync mode", "\u540C\u6B65\u6A21\u5F0F")).setDesc(tr("PQC uses a separate remote folder. Switching modes keeps the notes on this device.", "PQC \u4F7F\u7528\u72EC\u7ACB\u7684\u8FDC\u7AEF\u76EE\u5F55\u3002\u5207\u6362\u540E\u672C\u673A\u7B14\u8BB0\u4F1A\u4FDD\u7559\u3002")).addDropdown((d) => d.addOption("legacy", tr("Passphrase (0.1.1)", "\u53E3\u4EE4\u540C\u6B65\uFF080.1.1\uFF09")).addOption("pqc", tr("Post-quantum (PQC)", "\u540E\u91CF\u5B50\u52A0\u5BC6\uFF08PQC\uFF09")).setValue(p.mode).onChange((mode) => {
      try {
        p.selectMode(mode);
      } catch (e) {
        new Notice(e.message);
      }
      this.display();
    }));
    if (p.mode === "pqc") {
      p.pqc.display(el, () => this.display());
      return;
    }
    const draft = { ...p.config };
    let password = "", passphrase = "";
    const field = (label, key, hint, placeholder) => new Setting(el).setClass("homebound-field").setName(label).setDesc(hint).addText((t) => t.setValue(draft[key] || "").setPlaceholder(placeholder).onChange((v) => {
      draft[key] = v;
    }));
    field(tr("LAN WebDAV address", "\u5C40\u57DF\u7F51 WebDAV \u5730\u5740"), "home", tr("Use the server\u2019s HTTPS address.", "\u586B\u5199\u670D\u52A1\u5668\u7684 HTTPS \u5730\u5740\u3002"), "https://nas.example.net/dav");
    field(tr("Away WebDAV address", "\u5916\u7F51 WebDAV \u5730\u5740"), "away", tr("Optional HTTPS gateway to the same server.", "\u53EF\u9009\u3002\u586B\u5199\u8F6C\u53D1\u5230\u540C\u4E00\u53F0\u670D\u52A1\u5668\u7684 HTTPS \u5730\u5740\u3002"), "https://dav.example.net/dav");
    field(tr("Remote folder", "\u8FDC\u7AEF\u76EE\u5F55"), "folder", tr("Type the folder name as written, including spaces or Chinese characters.", "\u53EF\u76F4\u63A5\u8F93\u5165\u4E2D\u6587\u3001\u7A7A\u683C\u548C\u591A\u7EA7\u76EE\u5F55\u3002"), "\u7B14\u8BB0/\u6211\u7684\u77E5\u8BC6\u5E93");
    field(tr("WebDAV username", "WebDAV \u7528\u6237\u540D"), "username", "", "");
    const secret = (label, cb) => new Setting(el).setClass("homebound-field").setName(label).setDesc(p.config.id ? tr("Leave empty to use the saved secret.", "\u7559\u7A7A\u53EF\u6CBF\u7528\u5DF2\u4FDD\u5B58\u7684\u5BC6\u7801\u3002") : "").addText((t) => {
      t.inputEl.type = "password";
      t.inputEl.autocomplete = "off";
      t.onChange(cb);
    });
    secret(tr("WebDAV password", "WebDAV \u5BC6\u7801"), (value) => {
      password = value;
    });
    secret(tr("Vault encryption passphrase", "\u7B14\u8BB0\u5E93\u52A0\u5BC6\u53E3\u4EE4"), (value) => {
      passphrase = value;
    });
    const review = (create) => {
      try {
        const config = {
          ...draft,
          home: core.endpoint(draft.home),
          away: draft.away.trim() ? core.endpoint(draft.away) : "",
          folder: core.directory(draft.folder),
          username: draft.username.trim()
        };
        const changedFolder = config.folder !== p.config.folder;
        if (create || changedFolder) config.id = "";
        new ConfirmFolder(this.app, config, create, () => p.bind(config, create, password, passphrase).then((ok) => {
          if (ok) this.display();
        })).open();
      } catch (e) {
        new Notice(e.message);
      }
    };
    new Setting(el).addButton((b) => b.setButtonText(tr("Create new vault\u2026", "\u521B\u5EFA\u65B0\u5E93\u2026")).onClick(() => review(true))).addButton((b) => b.setCta().setButtonText(tr("Connect existing vault\u2026", "\u8FDE\u63A5\u5DF2\u6709\u5E93\u2026")).onClick(() => review(false)));
    if (!p.config.id) return;
    new Setting(el).setName(tr("Sync while open", "\u6253\u5F00\u671F\u95F4\u81EA\u52A8\u540C\u6B65")).setDesc(tr("Check for changes every five minutes.", "\u6BCF\u4E94\u5206\u949F\u68C0\u67E5\u4E00\u6B21\u53D8\u66F4\u3002")).addToggle((t) => t.setValue(Boolean(p.config.auto)).onChange(async (value) => {
      p.config.auto = value;
      await p.saveData(p.config);
    }));
    new Setting(el).addButton((b) => b.setButtonText(tr("Sync now", "\u7ACB\u5373\u540C\u6B65")).onClick(() => p.run()));
    if (p.last) el.createEl("p", { text: p.last });
  }
};
module.exports = class HomeboundPlugin extends Plugin {
  async onload() {
    this.closed = false;
    this.cache = /* @__PURE__ */ new Map();
    this.config = {
      home: "",
      away: "",
      folder: this.app.vault.getName(),
      username: "",
      id: "",
      auto: false,
      ...await this.loadData()
    };
    if (this.manifest.id !== "homebound-webdav") throw Error("Install this candidate as Homebound WebDAV.");
    const savedMode = this.app.loadLocalStorage(modeKey);
    if (savedMode != null && savedMode !== "legacy" && savedMode !== "pqc") throw Error("Unknown Homebound sync mode.");
    this.mode = savedMode || "legacy";
    if (this.mode === "pqc") this.pqc = new PqcMode(this.app);
    this.settingsTab = new HomeboundSettings(this.app, this);
    this.addSettingTab(this.settingsTab);
    this.addCommand({ id: "sync", name: tr("Sync now", "\u7ACB\u5373\u540C\u6B65"), callback: () => this.run() });
    this.addCommand({ id: "resolve", name: tr("Resolve conflict using the active file", "\u4F7F\u7528\u5F53\u524D\u6587\u4EF6\u89E3\u51B3\u51B2\u7A81"), checkCallback: (checking) => {
      const file = this.app.workspace.getActiveFile();
      if (this.mode !== "legacy" || !file || !this.conflicts?.includes(file.path)) return false;
      if (!checking) this.run(file.path);
      return true;
    } });
    this.addCommand({ id: "seal-history", name: tr("Rotate PQC vault keys", "\u8F6E\u6362 PQC \u5E93\u5BC6\u94A5"), checkCallback: (checking) => {
      const q = this.pqc;
      if (this.mode !== "pqc" || !q?.config.admin) return false;
      if (!checking) q.exclusive(() => q.sealHistory()).then(() => new Notice(tr("Keys rotated.", "\u5BC6\u94A5\u5DF2\u8F6E\u6362\u3002"))).catch((e) => new Notice(e.message));
      return true;
    } });
    const syncIfEnabled = () => {
      if (this.mode === "legacy" && !this.closed && this.config.auto && !this.busy && document.visibilityState === "visible") this.run(null, true);
    };
    this.app.workspace.onLayoutReady(syncIfEnabled);
    this.registerDomEvent(document, "visibilitychange", syncIfEnabled);
    this.registerDomEvent(window, "online", syncIfEnabled);
    this.registerInterval(window.setInterval(syncIfEnabled, 3e5));
  }
  selectMode(mode) {
    if (mode !== "legacy" && mode !== "pqc") throw Error("Unknown sync mode.");
    if (this.mode === mode) return;
    if (this.closed || this.busy || this.pqc?.busy) throw Error(tr("Finish the current sync first.", "\u8BF7\u7B49\u5F53\u524D\u64CD\u4F5C\u5B8C\u6210\u540E\u518D\u5207\u6362\u3002"));
    const next = mode === "pqc" ? new PqcMode(this.app) : null;
    this.app.saveLocalStorage(modeKey, mode);
    if (this.pqc) this.pqc.closed = true;
    this.pqc = next;
    this.mode = mode;
  }
  onunload() {
    this.closed = true;
    if (this.pqc) this.pqc.closed = true;
  }
  secret(kind, config = this.config) {
    return config.secretId ? this.app.secretStorage.getSecret("homebound-" + config.secretId + "-" + kind) || "" : "";
  }
  async bind(config, create, enteredPassword, enteredPhrase) {
    if (this.closed || this.mode !== "legacy") return false;
    if (this.busy) {
      new Notice(tr("Sync is busy.", "\u540C\u6B65\u8FDB\u884C\u4E2D\u3002"));
      return false;
    }
    this.busy = true;
    try {
      const password = config.username ? enteredPassword || this.secret("dav") : "";
      const phrase = enteredPhrase || this.secret("vault");
      if (!phrase || create && phrase.length < 12) throw Error(tr("Use a vault passphrase of at least 12 characters when creating a vault.", "\u521B\u5EFA\u65B0\u5E93\u8BF7\u4F7F\u7528\u81F3\u5C11 12 \u4E2A\u5B57\u7B26\u7684\u52A0\u5BC6\u53E3\u4EE4\u3002"));
      if (create) {
        const header = await core.createVault(new Dav(config.home, credentials(config.username, password)), config.folder, phrase, namespace);
        config.id = header.id;
      }
      const { store } = await connect(config, password, phrase);
      config.id = store.id;
      config.secretId = config.secretId || core.randomId();
      this.app.secretStorage.setSecret("homebound-" + config.secretId + "-vault", phrase);
      if (password) this.app.secretStorage.setSecret("homebound-" + config.secretId + "-dav", password);
      config.auto = false;
      await this.saveData(config);
      this.config = config;
      this.cache.clear();
      this.conflicts = [];
      new Notice(tr("Vault connected.", "\u5DF2\u8FDE\u63A5\u7B14\u8BB0\u5E93\u3002"));
      return true;
    } catch (e) {
      this.last = e.message;
      new Notice(this.last, 1e4);
      return false;
    } finally {
      this.busy = false;
    }
  }
  async run(resolve = null, quiet = false) {
    if (this.closed || this.busy) return;
    if (this.mode === "pqc") {
      const q = this.pqc;
      try {
        const result = await q.exclusive(() => q.sync());
        new Notice(result.route + tr(" \xB7 uploaded ", " \xB7 \u5DF2\u4E0A\u4F20 ") + result.sent + tr(" \xB7 received ", " \xB7 \u5DF2\u63A5\u6536 ") + result.received);
        return result;
      } catch (e) {
        new Notice(e.message);
        return;
      }
    }
    this.busy = true;
    try {
      const c = this.config;
      if (!c.id) throw Error(tr("Connect a vault in settings first.", "\u8BF7\u5148\u5230\u8BBE\u7F6E\u4E2D\u8FDE\u63A5\u7B14\u8BB0\u5E93\u3002"));
      const { store, route } = await connect(c, c.username ? this.secret("dav") : "", this.secret("vault"));
      const key = "homebound-webdav-baseline-" + c.id;
      const baseline = new Map(this.app.loadLocalStorage(key) || []);
      const result = await core.synchronize({
        store,
        local: new VaultFiles(this.app),
        cache: this.cache,
        baseline,
        resolve,
        active: () => !this.closed,
        checkpoint: (data) => this.app.saveLocalStorage(key, Array.from(data))
      });
      this.cache = result.history;
      this.conflicts = result.conflicts;
      this.last = route + tr(" \xB7 uploaded ", " \xB7 \u5DF2\u4E0A\u4F20 ") + result.sent + tr(" \xB7 received ", " \xB7 \u5DF2\u63A5\u6536 ") + result.received;
      if (result.conflicts.length) this.last += "\n" + tr("Conflicts: ", "\u51B2\u7A81\u6587\u4EF6\uFF1A") + result.conflicts.join(", ") + "\n" + tr("Compare copies in Homebound conflicts, then resolve from the original file.", "\u8BF7\u6BD4\u8F83 Homebound conflicts \u4E2D\u7684\u526F\u672C\uFF0C\u518D\u6253\u5F00\u539F\u6587\u4EF6\u5E76\u8FD0\u884C\u89E3\u51B3\u51B2\u7A81\u547D\u4EE4\u3002");
      if (!quiet || result.conflicts.length) new Notice(this.last, 9e3);
      return result;
    } catch (e) {
      this.last = tr("Sync stopped: ", "\u540C\u6B65\u5DF2\u505C\u6B62\uFF1A") + e.message;
      if (!quiet) new Notice(this.last, 1e4);
    } finally {
      this.busy = false;
    }
  }
};
/*! Bundled license information:

@noble/curves/utils.js:
  (*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@noble/post-quantum/utils.js:
@noble/post-quantum/_crystals.js:
@noble/post-quantum/ml-kem.js:
@noble/post-quantum/ml-dsa.js:
  (*! noble-post-quantum - MIT License (c) 2024 Paul Miller (paulmillr.com) *)
*/
