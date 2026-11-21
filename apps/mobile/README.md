# Baton for iPhone

React Native + Expo（SDK 58）重写的 iOS 客户端。同一套 Mac 工作空间，全量功能：待我处理、任务中心（协作/文件/控制台/详情）、私聊与群聊、自动化、数字员工/团队/工作流/角色/插件/MCP/仓库访问、设置（外观、语言、Runtime 配置、日志）。

- 本机：Mac 菜单「连接 iPhone…」生成一次性配对码，手机扫码或粘贴链接。配对绑定 Mac 证书指纹（SHA-256），全程 HTTPS，设备令牌存 iPhone 钥匙串；可在 Mac 上单独撤销任一设备。
- 云端：多成员账号登录（按 docs/31 工作空间服务）。本机与云端共用同一客户端与 API。

## 运行（开发）

```bash
npm ci
npx expo prebuild --platform ios --clean   # 生成 ios/（CNG，勿手改）
npm start                                   # Metro；手机/模拟器装 dev build 后连接
npm run ios                                 # 或直接构建到模拟器
```

native 模块在 `modules/baton-transport`（证书固定的 HTTPS、SSE、上传/下载）。改 Swift 后需重新 `xcodebuild` / `expo run:ios`。

## 测试

```bash
npm test            # 单元测试（配对链接解析等）
npm run typecheck   # tsc
node tests/e2e/run.mjs <steps.json> <out-dir>   # 已装 App 的 UI 驱动（步骤 JSON）
```

E2E 驱动通过 bundle id 驱动已安装的 App；步骤 JSON 支持 launch/tab/tap/tapPoint/type/set/back/swipe/shot/dump 等。真机验收：起隔离工作空间、生成配对链接、打开 App 走完整流程。

## 打包真机

```bash
./package-device.sh build/BatonMobile.ipa
```

用 Xcode 组织 `Baton.xcworkspace`（scheme Baton）或直接_archive_ 出 IPA；开发签名 IPA 仅可装到描述文件授权的设备。首次安装如提示未受信任开发者，在 iPhone「设置 → 通用 → VPN 与设备管理」中信任。

## 结构

- `app/` Expo Router 路由；`(workspace)/` 为底部标签页。
- `src/ui` Graphite 组件（色板由 `scripts/build-tokens.mjs` 从 `web/tokens.css` 生成）。
- `src/features` 各业务能力；`src/api` 网关客户端（Bearer + 证书固定 + SSE）。
- `src/i18n` 复用 `client/i18n.mjs` 与 `client/locales/*.json`（简中源文本）。
