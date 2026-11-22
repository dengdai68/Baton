# 客户端

| 目录 | 入口与职责 |
| --- | --- |
| [electron/](electron/README.md) | 从 `main.mjs` 启动窗口、菜单和本机服务，在应用窗口加载 `web/` |
| [mobile/](mobile/README.md) | 从 `index.ts` 启动 Expo Router，iPhone 与 Android 共享 `src/`，原生传输在 `modules/` |

这是独立 Baton-App 的主入口，npm start/dev 默认启动 Electron；所有本机业务与界面依赖都在本仓库，见 [拆分边界](../docs/23-desktop-extraction.md)。

当前桌面客户端为 [Electron](electron/README.md)，复用 `web/` 与认证 HTTP。主进程只拥有窗口、自有后台及封闭宿主接口。

运行：`npm run desktop`。构建：`npm run package:mac`。详见 [客户端架构](../docs/18-electron-client.md)。

iOS 与 Android 客户端为 [mobile](mobile/README.md)（React Native + Expo 同一套代码，证书固定的 HTTPS + SSE，全量功能）。

工作空间账号、任务负责人、远程授权与 iOS 入口见[工作空间服务](../docs/31-workspace-service.md)。
