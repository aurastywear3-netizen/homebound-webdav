"use strict";

const core = require("./core.cjs");

function checkActive(active) {
    if (!active()) throw Error("操作已停止，请重新打开插件后继续。");
}

// The only writer during setup is the device holding the unpublished sharing key.
// Retrying always takes the trusted local files as the source, never the partial remote copy.
async function seedSnapshot(store, local, active) {
    const {groups:heads, localPaths:paths} = await core.syncScope(local,await store.history(new Map()));
    core.checkAliases([...paths]);
    for (const path of new Set([...paths, ...heads.keys()])) {
        checkActive(active);
        if (!core.safePath(path) || !local.allowed(path)) throw Error("此路径无法同步：" + path);
        const bytes = await local.read(path);
        const hash = bytes === null ? null : await core.sha(bytes);
        const current = heads.get(path) || [];
        if (current.length > 1) throw Error("目标库出现并发修改，请检查目标目录。");
        if (hash !== (current[0]?.hash ?? null)) {
            await store.publish(path, current.map(rev => rev.id), bytes);
        }
    }

    // Re-read the published metadata and ciphertext from storage, including chunked files.
    const {groups:published,localPaths:remaining} = await core.syncScope(local,await store.history(new Map()));
    const baseline = new Map();
    for (const [path, versions] of published) {
        checkActive(active);
        const [rev] = versions;
        const bytes = await local.read(path);
        const hash = bytes === null ? null : await core.sha(bytes);
        if (versions.length !== 1 || rev.hash !== hash) throw Error("文件已变化，请继续重试：" + path);
        if (hash !== null) await store.readBody(rev, {audit:true});
        baseline.set(path, {ids:[rev.id], hash});
        remaining.delete(path);
    }
    if (remaining.size) throw Error("有文件尚未上传，请继续重试。");
    checkActive(active);
    return baseline;
}

// An old offline copy must never silently publish stale notes into a freshly rotated vault.
async function checkJoin(history, local, previousBaseline = new Map(), {progress, active = () => true} = {}) {
    const {groups:heads, localPaths:paths} = await core.syncScope(local,history);
    const updates = [];
    let checked = 0;
    for (const path of paths) {
        checkActive(active);
        progress?.("local", checked++, paths.size);
        const bytes = await local.read(path);
        const hash = bytes === null ? null : await core.sha(bytes);
        const versions = heads.get(path) || [];
        if (versions.some(rev => rev.hash === hash)) continue;
        // Files still matching the old checkpoint can safely follow the new snapshot.
        if (previousBaseline.get(path)?.hash === hash && versions.length <= 1) {
            updates.push({path, hash, target:versions[0]});
        } else {
            throw Error("本地文件与远端不一致：" + path + "。请先备份未同步的修改，使用空本地库加入。");
        }
    }
    for (const [path, base] of previousBaseline) {
        if (base.hash !== null && !paths.has(path) && heads.get(path)?.some(rev => rev.hash !== null))
            throw Error("本地有尚待核对的删除：" + path + "。请先备份并使用空本地库加入。");
    }
    checkActive(active);
    if (paths.size) progress?.("local", paths.size, paths.size);
    return updates;
}

module.exports = {seedSnapshot, checkJoin};
