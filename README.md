# Homebound WebDAV · 0.2.2-rc.3

这是使用正式插件 ID `homebound-webdav` 的双模式候选包。独立测试通过后仍需另行决定正式发布。手动测试时，用 `main.js`、`manifest.json`、`styles.css` 覆盖测试库原插件目录中同名文件，保留 `data.json`，然后重新加载插件。回退 0.1.1 时也只替换这三个文件。

## 单地址设置

所有设备填写同一个 **WebDAV 地址**，例如 `https://dav.example.net/personal`。插件沿用旧设置中的外网地址。仅保存了局域网地址的设备需要填写 VPS 入口；插件不会自动连接旧局域网地址。已配对的 PQC 设备保留可信提交服务的完整路径，WebDAV 网关须与该服务同源。建库授权仅在首次创建时使用。每个新库应使用独立的 WebDAV 目录和提交数据库。

## PQC 设备与扫码加入

每个 PQC 库最多授权 10 台设备，管理员占一个名额。每台已授权设备都可以在设置中查看管理员、本机和其他成员，点「刷新设备列表」获取最新签名记录。管理员可以在成员旁边点「撤销」，核对设备指纹后确认。撤销会轮换库密钥；设备上已经下载的笔记仍由该设备保管。

1. 管理员在「已授权设备」点「显示加入二维码」，保留弹窗。
2. 新设备先安装并启用同一候选版，在准备加入的本地库用系统相机打开邀请，或在插件的 PQC 设置点「扫码加入（拍照或选图）」选择照片。检查网关、库指纹和本地库名称，然后填写设备名称和本设备的 WebDAV 用户名及密码。
3. 管理员核对两端显示的核对码，点「两端核对码一致，批准加入」。新设备点「刷新设备列表」或「立即同步 / 检查配对」。
4. 每个二维码可用于一台新设备，有效期十分钟。打开新二维码或更改设备授权会使旧码失效。二维码里只有网关、库指纹和临时邀请信息，图像由设备本地识别。手动配对码仍可使用。

升级前已超过 10 台的库可以继续同步、撤销或恢复；需先减至 9 台或更少才能再批准一台新设备。自托管部署请同步更新本库的提交服务，使旧客户端也受同一上限约束。

## 升级与模式选择

现有用户升级后默认沿用 0.1.1 口令模式、WebDAV 地址、账号、加密口令、同步记录和自动同步设置。没有手动选择过 PQC 的设备不会创建 PQC 身份或访问 PQC 服务。每个本地库独立保存模式选择。回退到 0.1.1 会恢复原口令库的行为，包括原先启用的自动同步。

要使用 PQC，请在插件设置的“同步模式”选择“后量子加密（PQC）”。选中时只初始化此设备的本地配置。填写此库的 WebDAV 地址后，由用户发起建库或配对。创建人先离线保存恢复码，再确认创建。其他设备核对库指纹并发起配对，管理员确认配对码后，设备才能取得库密钥。两种模式都会同步当前本地库里的文件。切换模式或回退后再次同步，可能将本地新增内容发送到所选模式对应的远端。要分开保存两套笔记，请使用不同本地库。

PQC 使用独立的 `Homebound-PQC/pqc-preview-2` 目录及每库独立的提交服务。WebDAV 保存加密正文，提交服务为授权变化和提交排序。家里和外出均使用同一个 VPS HTTPS 地址；PQC 网关需将该地址下的 `homebound-pqc-ledger/{state,policy,commit}` 转交给此库的提交服务，其余所需的 WebDAV 路径转交给存储服务器。URL 中的库路径前缀会保留。服务实现见 `witness/server.py`，须部署在回环地址并由 HTTPS 代理提供访问。每个库使用自己的数据库；备份需包含一致的数据库快照、对应 WebDAV 密文以及单独保管的当前恢复包。丢失设备后应撤销设备并另行吊销该设备的 WebDAV 凭据。切换回口令模式会保留本机的 PQC 配对。beta 预览版的插件 ID 和远端目录与此候选版不同。

本机可使用 Node 22.19+ 和 Python 3 执行 `npm ci`、`npm run build`、`npm test`。查看 [候选版真机验收](RC1-ACCEPTANCE.md) 了解本次结果。

## PQC 管理员逐修订换钥

管理员每发布一条文件修订，客户端都会生成独立的随机 256 位 `K_epoch`，用它加密该修订的清单。每个现有成员及恢复身份都用各自的公钥重新做一次 ML-KEM-768 封装，分别得到新的封装密文、共享秘密和 AES-GCM 密钥环密文。设备身份公钥保持稳定。附件正文使用独立的随机文件密钥。一份分块附件在提交完整修订时换一次代。

一次同步里新增、修改、删除或解决冲突的每条管理员修订都单独换代。仅拉取修订或空同步时保留当前代。普通成员使用当前代提交。可信提交服务在一个 SQLite 事务中校验当前授权，将签名换钥记录与它绑定的签名修订一起发布。新版客户端用新代的历史密钥链接读取以前的数据。配对、撤销、恢复仍各自更新授权。

**升级顺序**是先备份库并升级该库的 [可信提交服务](witness/server.py)，然后更新管理员插件。首次成功提交逐修订换钥后，该库的提交服务将拒绝旧版管理员的普通写入。rc.2 普通成员可以读写。已有库继续使用原数据库、恢复包与历史文件。如部署的服务在代理后，继续使用现有的 `state`、`policy` 和 `commit` 路径。口令模式使用原有格式。

单独泄露某一代的 `K_epoch` 时，之后生成的新代密钥仍有独立的随机性。掌握仍获授权设备私钥的人可以解封该设备的历代信封；当前恢复身份同样可以恢复全库历史。每次管理员提交都会为所有接收者新增封装，并保留一条签名记录。同步仍需读取并校验历史，长期高频写入会增加带宽、存储和启动校验开销。

## U30 大附件分块续传

先将同一远端库的所有设备升级到支持分块的版本，再在需要上传的设备上打开 **设置 → Homebound WebDAV → 大附件分块续传**。开关默认关闭。口令模式和 PQC 模式都支持；开关对局域网与外网生效。旧版可以继续使用原格式文件，但读不了已经分块的附件。关闭开关只影响之后写入的版本。

同步时，插件将至少 4 MiB 的文件拆成 512 KiB 的加密块。提示显示当前文件、方向、已完成块数、百分比和重试次数。临时网络错误最多自动重试三次，间隔为 0.5、1、2 秒。网络恢复后再次点“立即同步”，同一设备会接着上次的进度传输。若服务器可能已收到最后一块，插件会读回并验证这一块。更改文件、父版本或 PQC 授权后会重新上传。设备会在打开传输缓存时清理超过七天的旧进度。

下载逐块验证并校验整份文件，然后写入本地库。Obsidian 读写附件仍需要足够的设备内存。服务器可能留有取消上传产生的未提交密文块；备份时请保留整个远端对象目录。PQC 恢复校验逐块读取服务器，上传的修订通过提交服务的授权检查后才会出现在其他设备上。

## PQC 笔记冲突

两台设备离线修改同一篇笔记时，联网后各自执行“立即同步”。在插件设置找到对应文件，点“比较冲突副本”。每份副本列出提交设备和版本；对照正文，选中要保留的版本，再点“采用选定正文”。也可以打开原笔记，从命令面板运行“比较 PQC 冲突副本”。如果要自行合并文字，先编辑并保存原笔记，重新比较时可选择本机当前正文。

选择删除版本需要点击“确认采用删除版本”。同步到的其他版本会保存在本地的 `Homebound conflicts` 目录供查阅。取消比较会保留冲突。如果比较期间正文或远端版本已经变化，请重新同步、打开比较并核对新版本。另一台设备再次同步后即可取得选定内容。

## Passphrase mode (0.1.1) setup

1. Install and enable the plugin in Obsidian 1.11.4 or later. For a manual install, put `main.js`, `manifest.json` and `styles.css` together in the vault's configuration folder under `plugins/homebound-webdav/`.
2. In settings, enter the **WebDAV address** of your HTTPS gateway, a folder such as `Notes/个人 笔记`, and the WebDAV account credentials. Enter folder names literally, including spaces, Chinese characters and percent signs. The input occupies its own full-width row. Review the resulting destination in the confirmation dialog.
3. On the first device, choose an empty folder, enter a strong vault passphrase, then select **Create new vault** and confirm. Keep the passphrase in your password manager. Other devices select **Connect existing vault** with the same directory, account and passphrase. A device can join an existing vault from away.
4. Run **Sync now** from settings or the command palette. The result shows the chosen route and counts. Enable **Sync while open** to check on opening or returning to the app, on reconnection, and every five minutes while visible. Mobile operating systems may suspend the app in the background.
5. For remote access, use an existing private network or set up the [outbound SSH tunnel and HTTPS gateway](relay/README.md). The same gateway handles creation and synchronization on every network.

Existing Remotely Save vaults use another format, including rclone crypt. To switch, fully sync the original plugin, back up the decrypted local vault, then disable the original sync. Create a new empty remote directory and upload from that local copy. Keep the old remote directory for recovery.

## Conflict handling and recovery

Changes are recorded as immutable encrypted revisions. If two devices independently edit or delete the same file, sync continues on other paths. The plugin keeps the local file and saves copies of competing contents under `Homebound conflicts/<revision>/<original path>`. Compare them, edit the original, then run **Resolve conflict using the active file**. If one device deleted the original, use a device that still has the file, or copy the version you want back to its original path and sync. Run the command on that path. A later deliberate deletion can be synced after resolution.

Deletions are explicit revisions. The plugin passes synced local deletions to Obsidian's configured trash handler. A new device with an empty vault downloads the current files. Empty folders, hidden files, the configuration folder and the reserved conflict folder are excluded. File names must be portable across supported devices. Each changed attachment fits in device memory. Server history grows with changes and the initial scan reads one small metadata record per revision. Keep an independent backup of the whole remote folder. An interrupted setup can be retried in the same folder. Unpublished staging directories have names beginning with `homebound-init-` and contain setup data only.

## Passphrase mode privacy and network use

Only the WebDAV endpoints you configure receive requests. Use HTTPS with a trusted certificate. The plugin uses Obsidian Secret storage for WebDAV passwords and vault passphrases. The folder you enter, endpoint addresses and WebDAV username are saved in plugin settings. Device checkpoints include local paths and content hashes. There is no vendor account, telemetry or hosted service. The optional SSH gateway is self-hosted.

A per-vault random salt and PBKDF2-HMAC-SHA-256 (600,000 iterations) derive an AES-256-GCM key. Each encrypted object gets a random 96-bit nonce and authenticates its vault and object identifier. File names, relative paths, contents and hashes are encrypted. The server sees the folder you enter, random object identifiers, sizes, timing and history length. A gateway terminating HTTPS sees WebDAV credentials. Keep a dedicated account scoped to the sync folder. A lost vault passphrase cannot be reset. The first release uses an independent format and has not undergone an external security audit.

## 口令模式快速开始

所有设备填写同一个 WebDAV 网关 HTTPS 地址。远端目录支持中文、空格、百分号和多级路径，直接粘贴即可。首次在主设备选择“创建新库”，核对目录后确认。其他设备输入相同的目录与加密口令，选择“连接已有库”。通过命令面板或设置里的“立即同步”开始同步。

建议先用测试库走通一次“家中上传 → 蜂窝网络修改 → 家中读回”。如果在用 Remotely Save，请从已解密的本地副本向新目录迁移。异地访问的公网域名、VPS 配置和家庭端常驻连接见[外网接入说明](relay/README.md)。
