# 早期浏览器云端入口

`cloud.html` 与 `cloud.js` 提供早期云端地址入口。当前 iPhone 和 Android 客户端源码及安装说明见 [apps/mobile/](../../apps/mobile/README.md)。

手机远程访问在 Mac 的「设置 → 工作空间」页面内管理，由 `web/settings.mjs` 的 `createRemoteAccessUI` 渲染：Relay 地址与连接状态、Mac 接入指纹、一次性配对二维码、经 Relay 配对的手机，以及局域网与 SSH 转发。它调用本机已登录会话的 `/api/account/relay` 与 `/api/phone/` 接口。
