# 客户端

这是独立 Baton-App 的主入口，npm start/dev 默认启动 Electron；所有本机业务与界面依赖都在本仓库，见 [拆分边界](../docs/23-desktop-extraction.md)。

当前桌面客户端为 [Electron](electron/README.md)，复用 `web/` 与认证 HTTP。主进程只拥有窗口、自有后台及封闭宿主接口。

运行：`npm run desktop`。构建：`npm run package:mac`。详见 [客户端架构](../docs/18-electron-client.md)。

iOS 客户端为 [mobile](mobile/README.md)（React Native + Expo，证书固定的 HTTPS + SSE，全量功能）；旧 Swift/Web 壳归档于 [ios](ios/README.md)。

工作空间账号、任务负责人、远程授权与 iOS 入口见[工作空间服务](../docs/31-workspace-service.md)。
