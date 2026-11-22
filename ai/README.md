# 模块注册表

`module-registry.json` 供开发和 CI 使用。运行 `npm run check:impact` 时，脚本用它匹配改动文件与对应模块，核对必需文档和测试引用。查找代码先看 [代码导航](../docs/00-ai-map.md)，运行 AI 员工的实现入口见 [server/runtime/](../server/runtime/README.md)。

`module-registry.json` 记录模块职责、依赖边界、source of truth、测试及改动时必须更新的文件。

修改前读 [AGENTS.md](../AGENTS.md) 和 [代码导航](../docs/00-ai-map.md)。新增源码模块先登记；删除模块时同步引用。检查：`npm run check:ai`、`npm run check:impact`。
