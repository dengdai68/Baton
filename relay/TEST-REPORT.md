# Baton Relay 测试报告

2026-11-28，Apple Silicon Mac，Node.js 24.7.0，Xcode 26.4.1。Relay、Baton 服务和手机模拟器均使用隔离数据。公网侧使用本机独立 HTTPS 监听和测试 CA。

| 验证项 | 实际操作与结果 |
| --- | --- |
| 手机原生双向 TLS | iOS 26.4.1 的 iPhone 17e 模拟器运行使用产品 `RelayTLS.swift` 的测试应用。URLSession 通过 TLS 代理与 Mac 建立内层 TLS 1.3，核对 Mac 的 SPKI，提交钥匙串客户端证书，兑换一次性邀请。随后在独立通道请求带认证的测试 API，返回 200。 |
| Baton iOS App 正常入口 | 使用标准模拟器签名的 Release 构建。XCTest 从登录页打开扫码页、返回并进入「输入配对地址」，输入 Mac 管理页当场生成的地址后直接进入任务页。终止并重启 App 后仍能回到该工作空间。 |
| 系统打开二维码地址 | 完整 App 退出后，Apple Vision 验证新邀请的二维码内容，iOS 打开解码地址并在确认「打开」后自动进入任务页。Mac 随后从管理页面移除这台手机，账号的授权数变为零。 |
| 原生失败分支 | 同一模拟器测试了四种输入。替换 Mac 指纹时连接失败，替换邀请凭据时收到 410，原始有效邀请成功，重复使用原邀请失败。 |
| Relay 接入 | 配置允许两台 Baton 的身份公钥。使用测试手机的证书尝试登记路由得到 403。 |
| 独立部署 | 将 `server.mjs` 和 `wire.mjs` 复制到独立目录，只提供部署配置和证书。通过服务 CLI 启动后，允许名单中的 Mac 登记成功。发送 SIGHUP 移除该 Mac 后，现有连接关闭，服务目录未产生运行时数据文件。 |
| 并发兑换、重放、过期 | 两把设备密钥并发兑换同一邀请，只有一条通道建立。重放时路由不可用。另用隔离库推进邀请到期，确认未生成设备授权。 |
| 设备与工作区隔离 | Alice 与 Bob 的两个 Baton 实例连接同一 Relay。各自返回自己的账号数据。持另一把私钥使用 Alice 的有效令牌时返回 401。 |
| 事件流与二进制上传 | 内层 HTTP 连接保持打开时，手机端收到了 SSE 的 ready 事件。通过同一通道上传 20 MiB 二进制数据后，服务端 SHA-256 与源数据匹配。 |
| 撤销与恢复 | 移除 Alice 的第一台手机后该通道不可用，第二台手机与 Bob 均能访问。重启 Relay，两个 Baton 重新登记并可用原通道获取会话。清空 Alice 的 Relay 设置后 Bob 仍可用。 |
| Mac 真实管理入口 | 在带独立控制目录的 Baton 服务中登录，通过设置页实际保存地址、生成配对码、显示已兑换设备并点击移除。 |
| Electron 客户端 | 用 Electron 44.11.5 运行本次检出的桌面源码，使用独立账号、控制目录、后台服务及测试 CA。登录、从工作空间设置进入、保存地址、已连接状态、签发邀请及展开局域网/SSH 入口均通过。 |
| 既有登录 | 根测试集包含本地工作空间、认证网关和已登记反向代理的回归场景。 |
| Android | Gradle 离线构建 `:baton-transport:compileDebugKotlin` 成功。没有连接 Android 真机或模拟器。 |

## 可复现命令

```sh
node --test tests/relay.test.mjs
npm test
npm run check:ai
npm run check:impact
cd apps/mobile
npm test
npm run typecheck
```

桌面仓库测试在本机 SSD 的隔离检出中复跑，965 项全部通过。移动端测试 9 项全部通过，TypeScript 检查通过。一次 NAS 上的并行运行有 23 项失败。首次 SSD 复跑发现两个翻译检查失败，另有五个 DeepSeek Harness 测试因测试临时文件位于 ES 模块包内而无法使用 CommonJS。修正翻译并将测试临时目录移到仓库外后，全量复跑通过。新增的到期用例也在最终 Relay 专项测试中通过。

原生探针的运行结果与各场景记录随本次任务保存在 `relay-evidence/ios-native-result.txt` 和 `relay-evidence/ios-native-cases.json`。原生探针和协议测试使用测试账号与数据。公网域名、真实蜂窝网络和物理摄像头扫码尚未实测。

iOS 构建首次遇到 Expo 原生模块扫描超时，测试机上临时延长扫描时限后成功构建。首次安装使用关闭签名的构建，模拟器钥匙串以 OSStatus -34018 拒绝生成设备密钥。使用 Xcode 标准模拟器签名重建后，完整 App 的输入地址和重启用例通过。两次调整仅涉及测试机和构建选项。
