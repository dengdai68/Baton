# 工作空间 API

`client.ts` 复用原生传输模块，负责服务地址、认证、设备信息及统一的错误处理。`queries.ts` 将接口封装成页面可订阅的请求。登录状态和当前地址由 [workspace/](../workspace/README.md) 管理。
