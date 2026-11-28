# Baton Relay

Relay 为不能接受公网入站连接的 Mac 提供手机访问入口。两台 Mac 可以同时连接同一地址，每次成功配对都会创建属于签发账号和手机密钥的独立通道。[配对时序与设计](DESIGN.md)

## 部署

在公网主机上准备 Node.js 22.12 或更新版本、一个域名与受手机系统信任的 HTTPS 证书。保存完整证书链和私钥，限制服务账户读取私钥。手机和 Mac 均需要连通这个 TCP 端口。若前面有负载均衡器，请使用 TCP 透传，并将连接交给同一台 Relay 实例。

公网主机只需复制 `relay/` 目录和下方配置，无需安装 npm 依赖。从该目录的上一级运行以下命令。配置中的证书路径建议使用绝对路径。

```json
{
  "bind": "0.0.0.0",
  "port": 8443,
  "cert": "/etc/baton-relay/fullchain.pem",
  "key": "/etc/baton-relay/privkey.pem",
  "allow": []
}
```

```sh
node relay/server.mjs /etc/baton-relay/relay.json
```

1. 在 Mac 的「设置 → 工作空间 → 远程访问 · 添加手机」打开「Mac 接入指纹」。将显示的 64 位十六进制公钥指纹加入配置的 `allow` 数组。多个 Mac 分别添加。重启 Relay 可应用新配置并从在线的 Mac 恢复路由。
2. 在同一页面填入公网地址（如 `https://relay.example.com:8443`）并保存。显示「已连接」后点「添加手机」。
3. 在手机 Baton 登录页选择「扫码配对」或「输入配对地址」。邀请十分钟内可用一次。兑换成功后，手机进入签发邀请的 Mac 账号。
4. 在 Mac 上点某台手机旁的「移除」即可撤销其通道。被移除的手机仍能在 7 天内经 Relay 到达 Mac，收到 401 后显示「此设备已被移除」，而不是「Mac 离线」。更换或清空账号的 Relay 地址会撤销该账号此前的通道和邀请；这些手机经旧 Relay 已无法到达 Mac，只会显示无法连接。

首次配对前，持有完整有效邀请的设备能够兑换它。请通过受信方式传递二维码或地址。配对服务使用单管理员工作空间账号，支持 Mac 桌面及无图形界面的独立 Server。浏览器直接登录时使用工作空间地址。

Mac 使用命名曲线 P-256 编码接入证书。早期 macOS 测试版可能把曲线参数完整写进证书，导致桌面端打开远程访问页失败。升级后首次使用时会保留原私钥并重新签发这类证书。如果此前用命令行部署登记过旧编码的指纹，请将 Relay 接入名单更新为页面当前显示的指纹，重新配对使用旧指纹的手机。

## Docker 部署与证书

Baton 的 Relay 公网入口使用 HTTPS/TLS 1.3。Mac、iOS 和 Android 直接连接工作空间 Server 时可显式使用 HTTP 或 HTTPS。独立 Server 的构建、初始化、账号和容器内配对命令见[工作空间部署](../docs/31-workspace-service.md#docker-部署独立-server)。

证书签给客户端填写的 Relay 域名。可以使用 Let’s Encrypt 和 Certbot。下面是 Linux 部署示例。域名的 A/AAAA 记录须指向部署入口，HTTP-01 验证需让签发机构能访问 TCP 80，Certbot 的 standalone 模式需要占用该端口。无法开放 80 时，可使用 DNS 服务商对应的 Certbot DNS 插件，通过 TXT 记录验证域名。[Let’s Encrypt 验证方式](https://letsencrypt.org/docs/challenge-types/) · [Certbot 证书与续期](https://eff-certbot.readthedocs.io/en/stable/using.html#where-are-my-certificates)

```bash
DOMAIN=relay.example.com
sudo certbot certonly --standalone -d "$DOMAIN"
sudo groupadd --system -f baton-tls
CONF=/srv/baton/relay-config
sudo install -d -o root -g baton-tls -m 0750 "$CONF"
sudo install -o root -g baton-tls -m 0640 "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" "$CONF/fullchain.pem"
sudo install -o root -g baton-tls -m 0640 "/etc/letsencrypt/live/$DOMAIN/privkey.pem" "$CONF/privkey.pem"
sudo tee "$CONF/relay.json" >/dev/null <<'JSON'
{"bind":"0.0.0.0","port":8443,"cert":"/config/fullchain.pem","key":"/config/privkey.pem","allow":[]}
JSON
sudo chown root:baton-tls "$CONF/relay.json"
sudo chmod 0640 "$CONF/relay.json"
```

以下构建命令从仓库根目录执行，构建上下文只包含 Relay。将目录挂载为只读，容器用非 root 用户及专用补充组读取配置和私钥。宿主 TCP 443 映射到容器 8443；客户端填 `https://relay.example.com`。也可发布其他端口，并将端口写入 Relay 地址。

```bash
docker build -f relay/Dockerfile -t baton-relay relay
docker run -d --name baton-relay -p 443:8443 --group-add "$(getent group baton-tls | cut -d: -f3)" \
  -v "$CONF:/config:ro" baton-relay /config/relay.json
```

空允许名单可启动服务。将 Mac 设置页或独立 Server 的 `relay DIR status` 返回的 64 位指纹添加到 `allow`，保存宿主的 `relay.json`，再运行 `docker kill --signal=HUP baton-relay`。每个实例单独登记。Relay 的配置、证书和允许名单来自宿主目录；在线连接由各 Server 重建。证书续期后，在 Certbot 的 deploy hook 中重复上面的两个 `install` 命令，然后执行 `docker restart baton-relay` 以加载新证书。工作空间 Server 使用自己的受信证书时，按相同方法更新其专用证书目录并重启对应容器。

Paseo 开源 Relay 的默认监听为 `127.0.0.1:4000`，使用 HTTP/WebSocket，可自托管明文监听；其托管入口使用 `wss://relay.paseo.sh`。这些是 Paseo 的协议选项。[Paseo 官方运行配置](https://github.com/getpaseo/paseo-relay#runtime-contract) · [托管连接测试](https://github.com/getpaseo/paseo/blob/main/packages/relay/src/live-relay.e2e.test.ts)

## 已实现的连接协议

Mac 向同一个 Relay 地址建立 TLS 1.3 出站连接，以客户端证书证明持有允许名单中的私钥。Relay 在内存中保存路由和活动连接。控制流登记路由，每个手机连接由 Mac 主动建立一条数据连接。公网无需部署工作区子域名、通配证书或额外端口。

手机向 Relay 发送标准 HTTPS CONNECT，CONNECT 目标为 `<随机路由号>.baton.invalid:443`。这个名称仅用作协议内的路由选择器，Relay 不解析 DNS，也不会按请求连接到任意主机。iOS 使用系统 HTTPS 代理接口（iOS 17+），Android 在设备内为 OkHttp 适配 HTTPS CONNECT。内层使用 TLS 1.3，手机固定 Mac 的 P-256 公钥，Mac 检查手机的客户端证书、通道和短期会话。邀请凭据仅出现在配对链接与内层兑换请求中。

Mac 在控制目录的 `relay-identity/` 保存身份，在 `relay-access.sqlite` 保存账号配置、邀请摘要和设备授权。Relay 只读取部署配置、证书和私钥。Relay 重启后 Mac 自动重连，按当前授权重建路由。同一 Mac 身份重连时，新控制连接立即接管旧连接（休眠或切换网络后残留的半开连接）的路由；其他 Mac 身份不能接管。部署时可直接运行协议测试。

```sh
node --test tests/relay.test.mjs
```

### 线上的字段与管理接口

| 操作 | 实现约定 |
| --- | --- |
| 生成邀请 | `baton://pair?v=1&relay=<主机及可选端口>&r=<32位十六进制>&fp=<64位十六进制>&t=<43位base64url>`。指纹是 Mac 公钥 SPKI 的 SHA-256。 |
| 管理账号 | 已登录的 Mac 会话通过 `GET/PUT/DELETE /api/account/relay` 读取、更换、清除设置。更新地址的 JSON 字段为 `relay`。 |
| 添加与移除手机 | `POST /api/account/relay/invites` 返回 `link`、`qr` 和 `expires`（Unix 毫秒）。管理页面读取账号接口的 `account` 显示签发人，并轮询 `devices` 查看已兑换的设备。`DELETE /api/account/relay/devices/<id>` 单独撤销。 |
| 绑定与续期 | 仅在内层 TLS 中使用 `POST /relay/redeem`（`t`、`device`）和 `POST /relay/session`。成功结果含 `channel`、`token`、`workspace`、`user`、`mode`。会话令牌有效期 15 分钟，授权按设备证书核验。 |
| 重载名单 | 更新配置的 `allow` 后向 Relay 进程发送 SIGHUP。移除的 Mac 会断开连接。更换公网证书时重启服务。 |

设计附录中的 HTTP/2、Upgrade 和部分字段是设计阶段的接口。当前版本在标准 HTTPS CONNECT 内建立端到端 TLS。独立实现客户端时以本页的协议、源码与测试为准。

[测试报告](TEST-REPORT.md) · [交互报告](INTERACTION-REPORT.md)
