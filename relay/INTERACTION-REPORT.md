# Baton Relay 交互报告

测试时使用隔离账号 `relay-test`。桌面操作使用隔离的 Baton 服务、Chrome 及运行本次检出源码的 Electron 44.11.5。截图保存在本次运行目录的 `relay-evidence/`。配对链接和二维码已在邀请截图中遮盖。

| 操作 | 观察 | 证据 |
| --- | --- | --- |
| 在 Mac 保存 Relay 地址 | 保存地址后，页面显示「已连接」，「添加手机」可以点击。 | `mac-connected.png` |
| 从 Electron 桌面应用添加手机 | 在隔离实例输入测试账号和密码，进入「设置 → 工作空间」，打开远程访问、保存 Relay 地址并等到「已连接」。点击「添加手机」显示真实二维码和地址，也能展开原有「局域网与 SSH 转发」。 | `electron-invitation.png` |
| 从工作空间设置进入远程访问 | 在 390 像素宽的 Chrome 窗口点击「远程访问 · 添加手机」，验证签发账号、展开指纹以及生成邀请后的页面均在视口内完整显示。 | `mac-narrow.png` |
| 点「添加手机」 | 页面出现二维码、一次性配对地址和十分钟有效期提示。将页面实际生成的二维码交给 Apple Vision 解码，读出的文本与页面的配对地址逐字相同。 | `mac-invitation.png`、`qr-decoding.txt` |
| 兑换并移除一台设备 | 使用协议测试设备兑换 Mac 页面生成的邀请，服务返回签发账号的令牌。页面显示设备名称和创建时间。点击「移除」，页面回到「尚无配对手机」。 | `mac-paired.png` |
| 从 Baton App 手动配对 | iPhone 17e 模拟器上的完整 Baton App 显示原有账号登录、扫码和输入地址三个入口。打开扫码页可看到相机授权入口。返回登录页并输入 Mac 生成的完整邀请后，App 自动进入任务页；结束进程后再打开仍回到任务页。 | `ios-login.png`、`ios-scan.png`、`ios-pair-form.png`、`ios-workspace.png`、`ios-relaunch.png` |
| 将二维码中的新邀请交给 iOS | 先从 App 设置退出，Mac 签发新邀请。Apple Vision 确认二维码文本，随后通过系统打开该地址。点 iOS 的「打开」后，Baton 自动进入任务页。Mac 设备列表中有一台手机，点击移除后授权数为零。此用例涵盖二维码解码和系统打开地址，使用的是模拟器。 | `ios-qr-link.png`、`mac-product-paired.png`、`ios-product.txt` |
| 在 iOS 原生传输层配对 | iPhone 17e 模拟器上的原生测试应用显示已以测试账号配对，认证 API 返回 200。测试使用 Mac 签发的配对地址。 | `ios-native-probe.png` |
| 处理无效邀请 | 原生测试应用分别提交错误 Mac 指纹、错误凭据和已消费的邀请。三次均未获得通道。 | `ios-native-cases.json` |

业务侧每次配对授予「当前账号＋这台手机」独立通道。手机切换到其他网络或 Relay 重启时沿用原通道。撤销设备后，Mac 在 7 天内继续登记该通道，手机经内层连接收到 401 并显示「此设备已被移除」；只有 Mac 未连接 Relay 时才表现为连接失败。

真机通过摄像头扫描实体二维码、蜂窝网络漫游、Android App 端到端交互和已安装的 Electron 发布包仍待实测。

## iOS V6 复测（2026-11-28）

iPhone 17e 模拟器（iOS 26.4.1）安装了由合并提交 `cee3875` 构建的完整 Release App。安装包和构建产物中的 JS bundle 经 SHA-256 核对一致。Mac 与 Relay 各自运行，测试账号为 `relay-v6`。以下截图位于运行目录 `relay-evidence/v6/`。

| 操作 | 手机或 Mac 上的实际结果 | 截图 |
| --- | --- | --- |
| 从 Mac 签发一次性邀请，在手机登录页输入 | 手机进入账号的任务页 | `ios-v6-paired.png` |
| 仅关闭测试 Mac 后台，再打开手机 App | 任务页显示「任务读取失败」和「重试」。未出现移除提示或重新配对按钮 | `ios-v6-offline.png` |
| 保持 Relay 在线，重启原 Mac 后台 | 手机使用原授权重新进入任务页 | `ios-v6-restored.png` |
| 在 Mac 点击该手机旁的「移除」 | 已配对列表从一台变为空；手机再次访问显示「此设备已被移除」和「重新配对」 | `mac-before-removal.png`、`mac-after-removal.png`、`ios-v6-removed.png` |
| 在手机点击「重新配对」 | 回到带有「扫码配对」「输入配对地址」的登录页 | `ios-v6-repair-login.png` |

合并时的协议测试和回归结果见[合并版测试报告](https://github.com/dengdai68/Baton/blob/cee3875185b4c478d74fcb7f66ac342d5e08315c/relay/TEST-REPORT.md)。

## 独立 Server 与客户端直连（2026-11-28）

Mac 签名 App 在隔离配置下，通过桌面登录入口分别打开 HTTP 和 HTTPS 工作空间。两次均进入远程任务页，页面使用自己的已登录会话读取当前账号成功。被连接的是本机使用同一 Server 源码启动的独立服务。运行目录中的 `relay-evidence/docker/mac-direct-http.png` 和 `mac-direct-https.png` 保存了任务窗口截图。

在 Linux 容器内，管理员使用独立会话依次查看指纹、登记 HTTPS Relay、签发邀请、列出并移除配对设备。另一个容器用协议测试客户端兑换邀请并读取账号。iOS 与 Android 直连的 URL 输入、HTTPS 证书分支及显式 HTTP 网络配置均已核对。[容器测试结果](TEST-REPORT.md#容器部署2026-11-28) · [部署命令](../docs/31-workspace-service.md#docker-部署独立-server)
