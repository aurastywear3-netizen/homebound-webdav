# Homebound WebDAV 0.3.9

Homebound WebDAV syncs encrypted notes and attachments between your Obsidian devices using an HTTPS WebDAV server you control. Each vault has its own folder and encryption key.

个人多 Vault 加密同步插件。每个本地 Obsidian 库连接一个远端子目录。多个库可以共用一个 HTTPS WebDAV 地址和账号，各自使用独立随机密钥。插件直接读写标准 WebDAV 服务。外出时设备也需要能访问这个 HTTPS 地址。

**从 0.2.2 或更早版本升级前**，请先用旧版完成同步，保留完整本地副本和旧库恢复材料。0.3.0 使用新的远端格式，迁移时请选择新的空目录。

**Upgrading from 0.2.2 or earlier?** Finish syncing with the old plugin and back up your complete local vault and recovery materials first. Version 0.3.0 uses a new remote format. Create the new vault in an empty WebDAV folder, then scan its QR code on your other devices. Keep the old remote folder and recovery materials if you need the previous revision history.

## Installation

Open **Settings → Community plugins → Browse** in Obsidian 1.11.4 or later. Search for **Homebound WebDAV**, choose **Install**, then **Enable**. Install the plugin in each local vault you want to sync.

## Usage

Initial vault creation and first join start with up to 20 concurrent WebDAV requests. A batch that receives HTTP 429 or 503 lowers the limit one step (20 → 12 → 8 → 4 → 1). Successful requests are retained. Verification and file transfers share the reduced limit. Later syncs use up to four requests. Verified revisions are cached in an encrypted file on this device. **Advanced settings → Rebuild local version cache** verifies every remote revision again and replaces the cache when verification succeeds.

1. On your first device, choose **Settings → Homebound WebDAV → Create new vault**, enter the WebDAV address, account and password, and choose a new, empty remote folder. Select **Continue**, confirm the upload and follow its progress in settings. The first device uploads files, verifies revision records and reads back the contents. Large attachments use the same request slots for their blocks. After an interruption, choose **Resume upload and verify** on that device.
2. Select **Back up vault key** and save the recovery key in your password manager. Keep the WebDAV credentials and folder name available for recovery.
3. Open an empty local vault on the second device. Choose **Scan to join** in the plugin settings, scan the code under **Use this vault on another device** on the first device, confirm the destination and select **Verify and sync**. The QR code contains the WebDAV password and this vault’s encryption key. Show it only to devices you trust.
4. After setup, sync runs automatically while the vault is open and visible. Local changes sync after a two-second pause. Every five seconds Homebound checks the WebDAV version marker and downloads new revisions when it changes. Returning to the foreground, reconnecting and the five-minute full check also trigger a sync. **Sync now** is available at any time. Repeat setup in another vault with its own remote folder and key.
5. Settings show the last successful sync, pending local uploads (including deletions), and unresolved conflicts. Markdown and plain-text notes use their shared revision to merge independent edits automatically. If both devices change the same passage differently, choose **Keep remote**, **Keep local** or **Edit** for that passage. Other edits from both devices are included when the result is saved. Independently created files, deletion versus editing, and binary attachments still require a file-level decision. You can reopen a dismissed comparison from settings.

When a conflict needs a decision, Homebound saves the versions in the plugin’s private `conflicts/` folder. Dismissing the comparison puts one local copy next to the original, for example `Note-20261123143005-conflict-<revision ID>.md`. The copy is excluded from sync. Once the conflict is resolved on either device, the next successful sync removes the unchanged sibling. **Advanced settings → Clear historical copies** in settings removes resolved local archives. Edited copies are kept.

## Version history

Open **View version history** in settings or the command palette. Select a synced file (including a recently deleted one) and a version, then **Compare changes → Restore this version**. Text has a line diff; attachments have sizes and SHA-256 digests. Restoration publishes a new revision and syncs it to other devices. Sync outstanding edits and resolve conflicts before restoring.

The default retention is **30 days**. Choose 30, 60, 90, 180 days or **Forever** per vault. The clock starts when a newer revision replaces a version. The current version and outstanding conflicts are protected. While a client is active, it periodically removes expired encrypted bodies and attachment blocks; the sync graph and deletion markers stay available for offline devices. Increasing retention cannot bring back a body already removed.

## 创建与加入

1. 在当前库启用插件，点「创建新库」，填写 WebDAV 地址、账号、密码和一个新的子目录。点「继续」，核对目标并确认本地副本完整。设置页会显示上传、核对远端版本和读回校验的进度，以及各阶段的完成数和总数。首次建库最多使用 20 路并发，大附件使用同一组名额传输分块，并单独显示分块进度。中断后在同一设备点「继续上传并校验」。
2. 点「备份库密钥」，将恢复密钥、地址、账号、密码和子目录保存到密码管理器。丢失最后一份密钥将无法解密远端数据。
3. 在另一台设备打开准备同步的本地库，启用插件并点「扫码加入」。扫描首台设备在「在另一台设备上使用此库」中显示的二维码，或在插件内读取二维码图片。确认本地库、远端地址和库标识后，窗口显示已核对的远端版本数；验证通过后，设置页显示已处理的文件数和总数。首次同步会重新列出提交，只下载新增版本的记录，并校验下载的正文和附件。没有摄像头时，也可填写 WebDAV 配置、粘贴恢复密钥并连接。建议首次加入使用空本地库；若已有文件与远端冲突，插件会提示先备份。
4. 在其他 Obsidian 库中重复建库，选用另一个远端子目录。库绑定后自动同步。文件编辑、创建、删除或改名后，停顿 2 秒即同步。应用在前台时每 5 秒轻量检查远端版本标记，有新提交就拉取。每 5 分钟、返回前台及恢复联网时还会完整检查。移动系统可能挂起后台应用。

首次建库和首次加入均从最多 20 路并发开始。某一批请求收到 HTTP 429 或 503 时，按 20 → 12 → 8 → 4 → 1 降一档，保留该批已成功的请求。后续版本核对和文件传输沿用降后的档位。日常同步最多 4 路。插件在本机插件目录加密保存已验证的版本记录。重新打开库时会核对远端提交清单，仅获取缺少的记录。可在「高级设置 → 重建本机版本缓存」重新核对，成功后替换旧缓存。

共享码包含 WebDAV 地址、账号、密码、远端目录、库标识及库密钥。它可以重复使用，请仅当面展示给自己的设备。每张码只含一把库密钥；该账号可列举、写入或删除哪些目录取决于服务器权限。恢复密钥独立于 WebDAV 密码，更新账号密码时可在已连接设备的「高级设置 → 修改 WebDAV 连接」中验证并保存。

## 设备遗失与换钥

先在 WebDAV 服务器撤销遗失设备知道的凭据。在可信设备和相关 Vault 中更新共享账号的密码。核对离线修改、冲突和本地副本的完整性。对遗失设备持有密钥的每个库，在「高级设置 → 换钥并迁入新目录」中填写新的独立空目录。插件为新库生成独立密钥，上传并验证当前文件，然后切换本机绑定。原目录和历史仍可用原密钥离线恢复。请事先保存原密钥及备份。换钥后的历史从当前快照开始。遗失设备已取得的文件和旧密文仍可能被读取。

在其余设备上扫码加入新库。直接从上一代重新加入时，仍匹配旧检查点的本地文件会跟随新快照更新或移入回收站；跨过多次换钥的设备可打开空本地库恢复。如果设备有未汇集的离线编辑，先备份这些编辑再合并。只共用账号、没有泄露库密钥的其他 Vault 可以只更新 WebDAV 密码。

## 历史版本与恢复

在插件设置或命令面板选择 **查看历史版本**，选中文件和版本，点 **比较差异 → 恢复此版本**。文本可以逐行查看增删，二进制附件可比较大小和 SHA-256。已删除的文件也可以从设置中找回。恢复会作为一次新修改同步到其他设备，恢复前的内容仍可在保留期内查看。若有尚未同步的改动或冲突，请先处理再恢复。

每个库默认保留 **30 天**，可选 **30、60、90、180 天或永久保存**，所有设备共用同一设置。历史版本从被新版本替换时开始计时。只要仍是当前版本，即使多年未改也会保留。存在待处理冲突的文件会暂缓清理。期限更改存入加密的 WebDAV 设置；缩短后，超期版本会从列表隐藏，客户端在成功同步时分批清理旧正文和附件分块。已清除的正文无法通过延长期限找回。已解决冲突的本机副本仍由「高级设置 → 本机冲突副本 → 清理历史副本」管理。

升级后，已有修订优先采用 WebDAV 的提交目录时间；服务器缺少日期时，从新版首次读取该修订起记录时间。修订关系和删除标记会保留，使离线设备能核对旧检查点。建议各端升级至 0.3.5；若长期离线后共同底稿已经过期，两端各自的修改会进入冲突比较，由用户选择版本。

## 数据与同步范围

每库随机生成 32 字节密钥。AES-256-GCM 认证加密正文、附件和含文件名、相对路径的修订元数据。WebDAV 上的对象使用随机标识，服务器能看到外层子目录、对象大小、数量及访问时间。插件将库密钥和 WebDAV 密码存入 Obsidian SecretStorage。库绑定和同步检查点保存在当前设备当前库的本地存储。

同步当前库内的笔记和附件，排除隐藏文件、Obsidian 配置、空目录及保留的冲突副本目录。至少 4 MiB 的附件自动分块传输，重新同步时恢复进度。设备仍需能在内存中读写整份附件。设置显示最后成功同步时间、待上传文件数（含删除）和冲突状态。Markdown 和纯文本笔记会根据共同版本自动合并并保存不同位置的修改。两端改到同一处且内容不同时，才会弹出比较框。每处可选「保留远端」「保留本地」或「编辑」，保存时会一起保留两端在其他位置的修改。独立新建的同名文件、删除与编辑冲突、二进制附件需要按整份文件选择。关闭比较框后可从设置中的「比较差异」重新打开。锁屏或后台暂停时可回到前台继续。

自动合并成功时不会创建冲突副本。需要人工选择时，版本先保存在当前库的 `.obsidian/plugins/homebound-webdav/conflicts/`；使用自定义配置目录的库会跟随该目录。关闭比较框、暂不处理时，原文件旁会出现一份本机副本，例如 `日记-20261123143005-conflict-<版本ID>.md`。时间采用本地的年月日时分秒，副本保留原扩展名，也不参与同步。两端任一设备解决冲突后，下次成功同步会收起未改动的同目录副本。设置中的「高级设置 → 本机冲突副本 → 清理历史副本」可以清除本机已解决的历史副本。待处理版本和用户改过的副本会保留。升级后，同步会将旧 `Homebound conflicts/` 中与修订记录匹配的原样副本迁入插件目录。

轮询优先使用提交目录的 WebDAV 属性。如果服务器不提供可用的版本属性，新版客户端在发布提交后更新一个小标记文件；在这类服务器上，旧版客户端的写入仍可通过完整检查发现。

服务端需支持 GET、PUT、PROPFIND、MKCOL 和同源 MOVE（Overwrite: F）。请保留整个远端目录的独立备份。拥有共享凭据的设备可以破坏远端数据，单台设备无法验证自己从未见过的历史是否完整。

## 从 0.2.2 或更早版本迁移

先在旧版本完成同步，核对冲突，备份已解密的本地库和旧版恢复材料。安装新版后，从完整本地副本在新的空目录创建个人库，再让其他设备扫码。旧口令格式和 PQC 库需要旧版及对应恢复材料读取。旧服务、旧库及其历史由用户自行保管。新版首次启动会等待显式配置。

## 本地开发

Node 22.19+。运行 `npm ci`、`npm run build`、`npm test`。手动安装使用同一构建的 `main.js`、`manifest.json` 和 `styles.css`，置于当前库配置目录下的 `plugins/homebound-webdav/`。
