# 手机端路由

`_layout.tsx` 定义应用顶层导航，`connect.tsx` 处理地址与账号登录。路由组 `(workspace)/` 提供任务、沟通、自动化和更多四个标签。平级的 `task/`、`chat/`、`automation/`、`directory/` 与 `settings/` 分别容纳详情、编辑页和设置页。业务组件位于 [features/](../features/README.md)。
