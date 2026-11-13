# Homebound WebDAV · 0.2.0-rc.1

这是使用正式插件 ID `homebound-webdav` 的双模式候选包。独立测试通过后仍需另行决定正式发布。手动测试时，用 `main.js`、`manifest.json`、`styles.css` 覆盖测试库原插件目录中同名文件，保留 `data.json`，然后重新加载插件。回退 0.1.1 时也只替换这三个文件。

## 升级与模式选择

现有用户升级后默认沿用 0.1.1 口令模式、WebDAV 地址、账号、加密口令、同步记录和自动同步设置。没有手动选择过 PQC 的设备不会创建 PQC 身份或访问 PQC 服务。每个本地库独立保存模式选择。回退到 0.1.1 会恢复原口令库的行为，包括原先启用的自动同步。

要使用 PQC，请在插件设置的“同步模式”选择“后量子加密（PQC）”。选中时只初始化此设备的本地配置。填写独立 WebDAV 库和自管 HTTPS 提交服务后，由用户发起建库或配对。创建人先离线保存恢复码，再确认创建。其他设备核对库指纹并发起配对，管理员确认配对码后，设备才能取得库密钥。两种模式都会同步当前本地库里的文件。切换模式或回退后再次同步，可能将本地新增内容发送到所选模式对应的远端。要分开保存两套笔记，请使用不同本地库。

PQC 使用独立的 `Homebound-PQC/pqc-preview-2` 目录及每库独立的提交服务。WebDAV 保存加密正文，提交服务为授权变化和提交排序。局域网同步也需要可信的 HTTPS 提交服务在线。服务实现见 `witness/server.py`，须部署在回环地址并由 HTTPS 代理提供访问。每个库使用自己的数据库；备份需包含一致的数据库快照、对应 WebDAV 密文以及单独保管的当前恢复包。丢失设备后应撤销设备并另行吊销该设备的 WebDAV 凭据。切换回口令模式会保留本机的 PQC 配对。beta 预览版的插件 ID 和远端目录与此候选版不同。

本机可使用 Node 22.19+ 和 Python 3 执行 `npm ci`、`npm run build`、`npm test`。查看 [候选版真机验收](RC1-ACCEPTANCE.md) 了解本次结果。

## Passphrase mode (0.1.1) setup

1. Install and enable the plugin in Obsidian 1.11.4 or later. For a manual install, put `main.js`, `manifest.json` and `styles.css` together in the vault's configuration folder under `plugins/homebound-webdav/`.
2. In settings, enter the **LAN WebDAV address**, an optional **Away WebDAV address**, a folder such as `Notes/个人 笔记`, and the WebDAV account credentials. Enter folder names literally, including spaces, Chinese characters and percent signs. The input occupies its own full-width row. Review the resulting destination in the confirmation dialog.
3. On the first device, choose an empty folder, enter a strong vault passphrase, then select **Create new vault** and confirm. Keep the passphrase in your password manager. Other devices select **Connect existing vault** with the same directory, account and passphrase. A device can join an existing vault from away.
4. Run **Sync now** from settings or the command palette. The result shows the chosen route and counts. Enable **Sync while open** to check on opening or returning to the app, on reconnection, and every five minutes while visible. Mobile operating systems may suspend the app in the background.
5. For remote access, use an existing private network or set up the [outbound SSH tunnel and HTTPS gateway](relay/README.md). The gateway forwards to the original WebDAV server, so both routes share one history. Initializing a vault requires the home route.

Existing Remotely Save vaults use another format, including rclone crypt. To switch, fully sync the original plugin, back up the decrypted local vault, then disable the original sync. Create a new empty remote directory and upload from that local copy. Keep the old remote directory for recovery.

## Conflict handling and recovery

Changes are recorded as immutable encrypted revisions. If two devices independently edit or delete the same file, sync continues on other paths. The plugin keeps the local file and saves copies of competing contents under `Homebound conflicts/<revision>/<original path>`. Compare them, edit the original, then run **Resolve conflict using the active file**. If one device deleted the original, use a device that still has the file, or copy the version you want back to its original path and sync. Run the command on that path. A later deliberate deletion can be synced after resolution.

Deletions are explicit revisions. The plugin passes synced local deletions to Obsidian's configured trash handler. A new device with an empty vault downloads the current files. Empty folders, hidden files, the configuration folder and the reserved conflict folder are excluded. File names must be portable across supported devices. Each changed attachment fits in device memory. Server history grows with changes and the initial scan reads one small metadata record per revision. Keep an independent backup of the whole remote folder. An interrupted setup can be retried in the same folder. Unpublished staging directories have names beginning with `homebound-init-` and contain setup data only.

## Passphrase mode privacy and network use

Only the WebDAV endpoints you configure receive requests. Use HTTPS with a trusted certificate. HTTP is accepted only on loopback for local testing. The plugin uses Obsidian Secret storage for WebDAV passwords and vault passphrases. The folder you enter, endpoint addresses and WebDAV username are saved in plugin settings. Device checkpoints include local paths and content hashes. There is no vendor account, telemetry or hosted service. The optional SSH gateway is self-hosted.

A per-vault random salt and PBKDF2-HMAC-SHA-256 (600,000 iterations) derive an AES-256-GCM key. Each encrypted object gets a random 96-bit nonce and authenticates its vault and object identifier. File names, relative paths, contents and hashes are encrypted. The server sees the folder you enter, random object identifiers, sizes, timing and history length. A gateway terminating HTTPS sees WebDAV credentials. Keep a dedicated account scoped to the sync folder. A lost vault passphrase cannot be reset. The first release uses an independent format and has not undergone an external security audit.

## 口令模式快速开始

局域网填写 WebDAV 的 HTTPS 地址，外网填写能转发至同一台服务器的 HTTPS 地址。远端目录支持中文、空格、百分号和多级路径，直接粘贴即可。首次在主设备选择“创建新库”，核对目录后确认。其他设备输入相同的目录与加密口令，选择“连接已有库”。通过命令面板或设置里的“立即同步”开始同步。

建议先用测试库走通一次“家中上传 → 蜂窝网络修改 → 家中读回”。如果在用 Remotely Save，请从已解密的本地副本向新目录迁移。异地访问的公网域名、VPS 配置和家庭端常驻连接见[外网接入说明](relay/README.md)。
