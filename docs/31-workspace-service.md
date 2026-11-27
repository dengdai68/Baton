# 工作空间服务与手机客户端

每个 Baton 服务实例拥有一个工作空间和一份业务数据库。云端由多个人类账号共用，本地使用 human_operator。手机和桌面浏览器使用相同的工作空间界面和 API。Electron 的原有管理接口仍受本机认证保护。网络接口逐操作授权，任务和自动化默认只对创建者可见，可指定负责人、协作者和只读成员。自动化运行继承定义的访问权限。私聊按用户和员工隔离。工作空间成员属于同一信任团队，Agent 使用实例运行账户的操作系统权限，部署应使用专用操作系统账号和工作目录。

手机通过系统信任的 HTTPS 登录云端。Mac 托管的服务使用管理员账号登录，每次登录建立可撤销的设备会话。Relay 使用标准 SSH 远程 TCP 转发，一个应用一把公钥和一个预分配端口。TLS 在 Baton 和客户端之间终止。每个实例独享工作目录。部署步骤见本文的[独立运行服务](#独立运行服务)。

| 部署 | 登录 | 手机路径 |
| --- | --- | --- |
| 本地单账号 | 工作空间地址和管理员账号 | iOS / Android → 局域网 HTTP，或经公网 HTTPS 反向代理 → Baton |
| 云端多人 | 每人独立账号 | iOS / Android 或桌面 → HTTPS → Baton |

需要验收或回复的普通任务仅进入有处理权限成员的待办。任一成员提交验收后，所有成员看到相同的结果和实际处理人。自动化异常按定义当前的成员权限展示。手机发送消息、创建任务和手动触发支持断线后重发。云端成员管理和共享资源配置由主机运营者执行。Relay 无需知道任务、账号或工作空间，连接端可用标准 OpenSSH 或附带的自动重连程序。手机客户端的构建与安装见 [apps/mobile](../apps/mobile/README.md)。

手机在连接失败时显示系统错误，并允许用户在同一地址重新连接。使用 HTTPS 时，已登录的手机重连时校验登录时确认的服务器证书。

## 独立运行服务

在项目根目录使用 Node.js 22.12 或更高版本，并为每个实例指定独立的私有目录。以下单管理员示例在本机回环地址监听。供局域网设备连接时，将 origin 换成服务器可达的内网地址，并按需指定监听 IP。

```sh
npm ci
npm run workspace -- init /srv/baton/local local http://127.0.0.1:9443 9443 127.0.0.1
npm run workspace -- operator /srv/baton/local operator < /private/operator-password
npm run workspace -- serve /srv/baton/local
```

云端多人模式需要为对外域名配置 DNS 和入站端口。以下示例由 Baton 终止 TLS。初始化后，在实例的 `workspace-service.json` 中将 `cert` 和 `key` 指向该域名的受信任证书链和私钥，再启动服务。

```sh
npm run workspace -- init /srv/baton/cloud cloud https://baton.example:9443 9443 0.0.0.0
npm run workspace -- member /srv/baton/cloud alice < /private/alice-password
npm run workspace -- operator /srv/baton/cloud operator < /private/operator-password
npm run workspace -- serve /srv/baton/cloud
```

使用 `member` 为其他成员创建账号。实例所在主机的管理员通过 CLI 管理运行环境与共享员工目录，每次调用使用该实例的端点和会话文件。

```sh
baton --endpoint-file /srv/baton/cloud/desktop-endpoint.json --session-file /srv/baton/cloud/cli-session.json auth login --username operator
baton --endpoint-file /srv/baton/cloud/desktop-endpoint.json --session-file /srv/baton/cloud/cli-session.json agents list
```

使用 `npm run workspace -- devices DIR` 查看设备，使用 `npm run workspace -- revoke DIR DEVICE_ID` 撤销授权。

## 手机客户端（apps/mobile：iPhone 与 Android）

手机任务列表使用搜索、快捷分组和任务状态筛选。Android 的沟通与协作记录使用系统 IME Insets 计算输入区的实际遮挡。

登录页在登录按钮下方选择工作空间，可在弹窗中保存 Mac 的局域网或公网地址。下拉列表用无凭据的 GET /healthz 检查 Baton 工作空间服务；每次登录只进入所选的一个空间。首次连接自签名证书时先核对指纹。成功后钥匙串（Android 为 Keystore 加密存储，不进入系统备份）仅保存当前授权，退出时撤销。设置页只读显示名称、登录地址和当前账号。

本机工作空间的网关验证同一管理员密码。设备会话关联账号及凭据版本，管理员重置凭据后旧授权失效。配置写入受设备范围约束，云端成员按资源授权。设备列表仅列出当前账号有效会话。

Android 与 iPhone 是同一套 React Native 代码、同一网关协议和同一组功能。原生传输模块 `apps/mobile/modules/baton-transport` 在 Android 上用 OkHttp 实现与 iOS 相同的契约：自签名证书按叶证书 SHA-256 指纹固定（固定的主机不再匹配主机名），未固定的主机使用系统信任库；登录总是新建 TLS 连接；不跟随重定向、不保存 Cookie；SSE 分帧、附件上传下载、不可变缓存和 `CODE: detail` 错误码一致。显式 http:// 地址所需的明文网络由该模块的清单开启，等同 iOS 的 NSAllowsArbitraryLoads；应用只申请相机和网络权限。导航栏按钮、菜单、操作列表、重命名输入和图片缩放分别使用各平台的系统控件，系统返回键等同导航栏返回；设备列表显示系统设置中的设备名称。

手机控制台与 Mac 共用 `client/console-projections.mjs` 投影：调用卡片、提示词快照、连续 Read 合并、Edit 差异、Shell 终端块与思考内容一致；任务文件的「变更」「交付快照」按目录树展示；任务详情可增删成员（与沟通群成员管理相同，执行中或有待交接的员工与当前项目经理不可移除）；自动化详情以自动化标题为页面标题，布局与任务详情一致。

## 工作空间目录与实时连接

Mac 登录时可选择本机或已保存的外部地址。两端登录页均可在登录按钮下方添加或移除保存的地址。选择器和列表以单行 URL 和小圆点显示连接状态，检测中为灰色，可用为绿色，失败或未就绪为红色。移除当前地址后，Mac 回到本机，iPhone 选择剩余首项或清空选择。省略协议使用 HTTPS，明确填写 http:// 则使用明文 HTTP，密码及会话信息不受传输加密保护。Mac 自动创建的工作空间使用 HTTP，桌面本机连接使用回环 HTTP。公网由 Lucky 等路由终止 HTTPS，以 HTTP 转发到内网端口并保留原始 Host。在 workspace-service.json 中用 origin 指定监听地址，用 accessOrigin 登记公网 HTTPS 地址；浏览器同源检查、Cookie 与设备信息会使用对应入口的协议。外部登录使用独立沙箱窗口，主机管理接口仅在本机生效。设置页展示当前机器、空间和登录设备的 IP，本机额外提供工作目录、后台服务开关和清除数据。

Mac 的登录选择器和本机设置都显示 workspace-service.json 的 origin（工作空间服务端地址）。回环控制端口仅用于桌面内部连接。远端设置返回当前访问的登记地址。登录请求体上限为 8 KiB，同时最多进行 4 次密码校验。每个来源 IP 在 10 分钟内登录失败 20 次后暂停登录 10 分钟。同一账号和来源 IP 在 24 小时内累计失败 20 次后，从第 20 次失败起封禁该组合 24 小时。封禁保存在访问库中，重启后继续生效。封禁前成功登录会清空该组合的失败计数。封禁期内继续尝试不会延长封禁。HTTP 429 的 `Retry-After` 提供剩余秒数。已认证会话与健康查询仍可用。

反向代理应覆盖 `X-Forwarded-For` 或把真实客户端地址追加到最后一项。若直接连接 Baton 的是反向代理，在 `workspace-service.json` 的可选 `trustedProxyAddresses` 数组中填写该代理连接 Baton 时的实际来源 IP。Baton 只采信列表内代理提供的最后一跳。未配置时使用 TCP 对端地址。Docker 的发布地址与实际回源来源 IP 可能不同，部署时按实际来源核对。远端错误只显示网关定义的公开消息。

已认证的 Mac 和已登录设备使用 `GET /api/workspace/events`。连接就绪后，`workspace-change` 按批次通知任务、沟通、自动化及两类控制台发生变化；客户端通过各自的已授权分页接口补读。Mac 可用 `runId` 在同一连接订阅当前运行的详细事件。心跳持续校验会话，设备撤销、退出和应用切入后台都会结束相应订阅。旧 Run 流仍服务已有调用者。

## 手机通过 Relay 访问 Mac

在 Mac 的设置中打开工作空间的「远程访问 · 添加手机」。配置 Relay 并登记 Mac 公钥后，每次添加手机都会生成独立邀请。手机使用扫码或手输入口完成端到端配对。配置、有效期、撤销及通信协议见 [Relay 部署说明](../relay/README.md)。
