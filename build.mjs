import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
const licenses = [];
for (const name of ["post-quantum","hashes","curves","ciphers"]) {
    licenses.push("@noble/" + name + "\n" + await readFile("node_modules/@noble/" + name + "/LICENSE", "utf8"));
}
licenses.push("jsQR\n"+await readFile("node_modules/jsqr/LICENSE","utf8"));
const mit = await readFile("LICENSE","utf8");
licenses.push("qrcode-generator\nCopyright (c) 2009 Kazuhiko Arase\n\n"+mit.slice(mit.indexOf("Permission is hereby granted")));
await build({ entryPoints: ["src/plugin.cjs"], outfile: "main.js", bundle: true,
    platform: "browser", format: "cjs", target: "safari16", external: ["obsidian"],
    banner: { js: "/*!\n" + licenses.join("\n").replaceAll("*/","* /") + "\n*/" } });
