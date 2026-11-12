# Homebound WebDAV

Sync notes and attachments to a private WebDAV server from home Wi-Fi or away. Use a direct HTTPS address at home and an optional second address for the same server through your own gateway. Notes, filenames and attachments are encrypted on each device. The plugin works with an ordinary WebDAV server supporting GET, PUT, MKCOL and depth-one PROPFIND. Initial setup also uses MOVE with overwrite disabled.

## Set up

1. Install and enable the plugin in Obsidian 1.11.4 or later. For a manual install, put `main.js`, `manifest.json` and `styles.css` together in the vault's configuration folder under `plugins/homebound-webdav/`.
2. In settings, enter the **LAN WebDAV address**, an optional **Away WebDAV address**, a folder such as `Notes/个人 笔记`, and the WebDAV account credentials. Enter folder names literally, including spaces, Chinese characters and percent signs. The input occupies its own full-width row. Review the resulting destination in the confirmation dialog.
3. On the first device, choose an empty folder, enter a strong vault passphrase, then select **Create new vault** and confirm. Keep the passphrase in your password manager. Other devices select **Connect existing vault** with the same directory, account and passphrase. A device can join an existing vault from away.
4. Run **Sync now** from settings or the command palette. The result shows the chosen route and counts. Enable **Sync while open** to check on opening or returning to the app, on reconnection, and every five minutes while visible. Mobile operating systems may suspend the app in the background.
5. For remote access, use an existing private network or set up the [outbound SSH tunnel and HTTPS gateway](relay/README.md). The gateway forwards to the original WebDAV server, so both routes share one history. Initializing a vault requires the home route.

Existing Remotely Save vaults use another format, including rclone crypt. To switch, fully sync the original plugin, back up the decrypted local vault, then disable the original sync. Create a new empty remote directory and upload from that local copy. Keep the old remote directory for recovery.

## Conflict handling and recovery

Changes are recorded as immutable encrypted revisions. If two devices independently edit or delete the same file, sync continues on other paths. The plugin keeps the local file and saves copies of competing contents under `Homebound conflicts/<revision>/<original path>`. Compare them, edit the original, then run **Resolve conflict using the active file**. If one device deleted the original, use a device that still has the file, or copy the version you want back to its original path and sync. Run the command on that path. A later deliberate deletion can be synced after resolution.

Deletions are explicit revisions. The plugin passes synced local deletions to Obsidian's configured trash handler. A new device with an empty vault downloads the current files. Empty folders, hidden files, the configuration folder and the reserved conflict folder are excluded. File names must be portable across supported devices. Each changed attachment fits in device memory. Server history grows with changes and the initial scan reads one small metadata record per revision. Keep an independent backup of the whole remote folder. An interrupted setup can be retried in the same folder. Unpublished staging directories have names beginning with `homebound-init-` and contain setup data only.

## Privacy and network use

Only the WebDAV endpoints you configure receive requests. Use HTTPS with a trusted certificate. HTTP is accepted only on loopback for local testing. The plugin uses Obsidian Secret storage for WebDAV passwords and vault passphrases. The folder you enter, endpoint addresses and WebDAV username are saved in plugin settings. Device checkpoints include local paths and content hashes. There is no vendor account, telemetry or hosted service. The optional SSH gateway is self-hosted.

A per-vault random salt and PBKDF2-HMAC-SHA-256 (600,000 iterations) derive an AES-256-GCM key. Each encrypted object gets a random 96-bit nonce and authenticates its vault and object identifier. File names, relative paths, contents and hashes are encrypted. The server sees the folder you enter, random object identifiers, sizes, timing and history length. A gateway terminating HTTPS sees WebDAV credentials. Keep a dedicated account scoped to the sync folder. A lost vault passphrase cannot be reset. The first release uses an independent format and has not undergone an external security audit.

## 中文快速开始

局域网填写 WebDAV 的 HTTPS 地址，外网填写能转发至同一台服务器的 HTTPS 地址。远端目录支持中文、空格、百分号和多级路径，直接粘贴即可。首次在主设备选择“创建新库”，核对目录后确认。其他设备输入相同的目录与加密口令，选择“连接已有库”。通过命令面板或设置里的“立即同步”开始同步。

建议先用测试库走通一次“家中上传 → 蜂窝网络修改 → 家中读回”。如果在用 Remotely Save，请从已解密的本地副本向新目录迁移。异地访问的公网域名、VPS 配置和家庭端常驻连接见[外网接入说明](relay/README.md)。

## Verification for 0.1.0

Two isolated Obsidian 1.15.0 desktop vaults exchanged a Markdown note and a binary attachment through an authenticated Apache WebDAV server. The second vault reached that server through a loopback gateway and a real reverse SSH tunnel while its direct endpoint was unavailable. The test exercised Chinese folder names with spaces, a literal percent sign, narrow settings windows, plugin reload, concurrent edits, conflict resolution, deletion and rejection of a different vault identity. A separate round trip through the supplied Caddy configuration verified TLS on both sides of the SSH forward with temporary test certificates. The U30, a physical iPad and a public cellular network still require field testing with this release.

## Build and release

Use Node.js 22 or later. No package installation is required.

```sh
node --test tests/sync.test.cjs
node build.mjs
```

For an initial community submission, publish only this project's source in a public GitHub repository. Commit the root manifest, README and license. The included GitHub Actions workflow tests the code, verifies the bundle, and publishes the three installation files under the tag matching the manifest. For a manual release, tag `0.1.0` and attach the files individually. Sign in to the Obsidian Community directory, link the repository owner's GitHub account, and submit the repository for review. [Official submission guide](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)
