# 在外网连回自己的 WebDAV

手机或 iPad 在外面时访问自己的 HTTPS 域名。VPS 上的 Caddy 把请求交给一条反向 SSH 隧道，隧道从 WebDAV 所在网络主动建立。家里无需公网 IP，也无需打开路由器的入站端口。局域网客户端直接连接 WebDAV。两条路径需要指向相同的 WebDAV 根目录。

## 所需设备

- 一台运行 WebDAV 的设备，以及能一直访问它并运行 SSH 客户端的设备。两者可以是同一台。如果 WebDAV 在随身热点上，建立隧道的设备也需要一直能访问那个热点。
- 一台公网 VPS 和一个指向它的域名。以下示例使用 OpenSSH、支持 `tls_trust_pool` 的 Caddy 2，以及局域网侧的 Linux/systemd。Android 和 OpenWrt 可用各自的服务管理器运行相同的 SSH 命令。
- WebDAV 的 HTTPS 证书、签发它的 CA 公钥证书，以及只可访问专用同步目录的 WebDAV 账号。插件会把凭据交给处理 HTTPS 的网关，网关应由你或你信任的人管理。

## 1. 在 VPS 配置转发账号

创建专用的 `homebound-tunnel` 用户，使用密钥登录。将局域网客户端的公钥加入该用户的 `authorized_keys`，在 sshd 配置末尾添加以下匹配段。在应用配置前先用 `sshd -t` 验证。

```text
Match User homebound-tunnel
    AuthenticationMethods publickey
    AllowTcpForwarding remote
    AllowStreamLocalForwarding no
    PermitListen 127.0.0.1:30443
    GatewayPorts no
    MaxSessions 0
    X11Forwarding no
    AllowAgentForwarding no
    PermitTTY no
```

## 2. 从局域网建立出站隧道

先在局域网设备上用专用密钥和经核对的 VPS SSH 主机公钥测试连接。把示例中的 WebDAV 主机名、端口和 VPS 域名替换为你的配置。

```sh
ssh -NT -i /etc/homebound/id_ed25519 \
  -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile=/etc/homebound/known_hosts \
  -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -R 127.0.0.1:30443:nas.home.arpa:443 homebound-tunnel@vps.example.net
```

要在 Linux 上开机自动重连，创建本机专用账号 `homebound`，将对应的私钥和已核对的主机公钥文件置于上面的路径。私钥只允许该账号读取。在 `/etc/homebound/tunnel.env` 填写：

```ini
DAV_HOST=nas.home.arpa
DAV_PORT=443
SSH_TARGET=homebound-tunnel@vps.example.net
```

把同目录的 `homebound-tunnel.service` 放入局域网设备的 systemd 系统服务目录，重新加载 systemd，启用并启动此服务。VPS 上的转发端口只监听回环地址。

## 3. 在 VPS 提供 HTTPS 入口

将签发 WebDAV 证书的 CA **公钥证书**放在 VPS 的 `/etc/caddy/webdav-ca.pem`，让 Caddy 有读取权限。使用同目录的 `Caddyfile` 站点配置。在 Caddy 服务环境中设置 `DAV_PUBLIC_HOST` 为公网域名，`DAV_TLS_NAME` 为 WebDAV 证书中有效的 DNS 名或 IP。域名解析到 VPS，并允许 Caddy 接收公网 HTTPS 流量及完成证书签发。

检查配置，再用现有 Caddy 服务加载站点。使用本示例时，两端 URL 中的 WebDAV 路径前缀保持一致。VPS 上不要将 `30443` 直接发布到公网。公网入口以家庭 WebDAV 的账号规则鉴权，部署前请确认匿名访问会返回 401 或 403。

## 4. 用测试库确认来回同步

1. 连上家庭网络，在插件中填写局域网地址与外网地址，在空目录创建加密库。
2. 在家创建一条测试笔记并点“立即同步”，结果应显示 LAN。
3. 手机切换为蜂窝网络，再次同步，结果应显示 VPS/VPN。在手机修改笔记并同步。
4. 回到家，在另一台设备同步，核对修改已出现。
5. 临时断开隧道时，在外网的同步应报错。恢复后再同步，已有库保持同一身份。笔记内容、标题、附件均以客户端加密格式经过 VPS，连接时间、数据量及 WebDAV 登录信息对 HTTPS 网关可见。

如果设备已经使用能够访问 WebDAV 的 VPN，填写可达的 HTTPS 地址即可。此方式可省略 VPS 组件。

[OpenSSH 远程端口转发](https://man.openbsd.org/ssh#R) · [OpenSSH 服务端权限](https://man.openbsd.org/sshd_config#PermitListen) · [Caddy HTTPS 上游配置](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#the-http-transport)
