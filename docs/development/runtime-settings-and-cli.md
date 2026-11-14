# 固定 Runtime 与默认 CLI

本轮落实固定 Provider 配置和客户端 CLI 入口，同时修正用户指出的空态、头像和任务标题。保留工作树里先前协作展示、公开思考和品牌修改；未提交、推送或发布。

## 行为

- 角色跟随原 MCP/插件无边框软表面空态，三者共用样式。生成头像改用高区分度紫、青、橙、绿、蓝实色及白色字形；不要求头像局限品牌色。任务工作台标题为 17px。
- Runtime 固定 Claude Code/Codex 各一项，以 Provider 显示，不可命名、新增或删除。列表有可用开关，右侧原生 dialog 抽屉仅编辑模型名字和思考等级；保留真实目录查询、手工模型和连接测试。
- Store 拥有启停规则。关闭阻止新任务、新沟通和后续 Provider 调用，不杀掉在途进程；重新启用不自动重发失败工作。修改配置更新当前员工，Task/Run/历史快照不变。
- HTTP/CLI 同步为 list/get/update/test/models，update 只接受 model/effort/enabled 的非空部分更新；旧名字、Provider 修改、自定义 CLI 路径、Codex profile、create/delete 明确拒绝。CLI 按 ID 或固定 Provider 引用。
- macOS 安装版从持久位置启动时默认安装用户级 CLI 和受管 Shell PATH 块，继续沿用不覆盖外部命令/并发改动的安装器。源码及临时卷不自动安装，设置页保留状态和修复。
- 宿主用正式 Cookie API 向同源认证端点获取父会话关联的独立委托，0600 原子发布到私有实例目录。CLI 验证 endpoint/实例后优先使用，客户端退出、重置或服务重启撤销。CLI 不读取浏览器文件/数据库，不保存密码；显式 session-file 或独立登录保留独立会话。CLI logout 不注销客户端。

## 验证记录

- 全量测试首轮 545 pass / 0 fail，覆盖固定项、部分更新、冻结、启停、HTTP/CLI 废弃输入，以及父会话撤销/委托链拒绝。最终重跑同为 545 pass / 0 fail（/private/tmp/baton-beta99-final-tests.log）；check:ai/check:impact、规定语法检查与 diff --check 通过。
- `node scripts/test-brand-presentation.mjs`：`.data/brand-presentation-ABT7Xd`，两主题、1320/760px，三目录最终空态样式一致、头像文字对比与键盘/错误态通过。
- `node scripts/test-runtime-settings.mjs`：`.data/runtime-settings-FaEa0B`，源码 Electron 登录后 CLI 无独立登录查询成功；退出 CLI 不影响客户端；两个固定项、关闭后任务/沟通/测试拒绝、抽屉仅两个字段、宽窄保存回读、旧协议拒绝通过。抽屉模型列表遮挡保存及收起移动按钮的问题在实测中发现并修正后重跑。
- 真实双 Provider 任务：`.data/runtime-settings-HZEN0l` / `run_mvwdpmvb_7`，Claude Code 经理派工、Codex 成员完成、经理提交人类验收。首轮脚本漏勾确认框导致最终等待超时，不能把该次脚本作为全程 PASS；续接相同运行在正常界面勾选确认框并确认，最终 Store 只读核对 completed 和 confirmedAt；`.data/runtime-settings-HZEN0l/real-completion.json` 留存三次完成 Trace 与双 Provider。续接临时脚本在确认后写证据时漏导入 writeFileSync，随后独立读取已保存状态补证，未重新驱动任务。
- 更早真实尝试 `.data/runtime-settings-JhiUbe` 因隔离环境没有传 CLAUDE_CONFIG_DIR 失败，修正测试环境；`.data/runtime-settings-W9iHyg` 窗口启动超时未形成模型结论。未删除失败证据。

## 边界

已有同一 Provider 多配置的数据明确拒绝启动，需在旧版本先整理为各一项；没有自动迁移、合并或重置真实实例。当前本机安装实例已通过正常界面确认恰好两项。移除可编辑 CLI 路径后，命令通过客户端登录 Shell PATH 查找；诊断同步指导检查安装、PATH 与重新打开客户端。

旧广覆盖 E2E 中使用新增 Runtime/自定义路径的设置步骤同步到固定协议并做语法检查；没有把未完整执行的旧脚本声称为通过。本轮当前端到端入口是 test-runtime-settings 和 test-brand-presentation。

## 打包验收中的修正

打包首轮 `.data/runtime-settings-J3vvRg` 在 CLI logout 检查发现夹具预建 `.baton` 为0755；按实际私有根0700修正夹具，未放宽产品检查。第二轮 `.data/runtime-settings-i98pqg` 发现自动安装仍用 Electron app.getPath(home)，忽略隔离 HOME；因此没有装入夹具目录。生产实现改为与数据目录一致的 Node homedir，旧手动安装验收同时改用隔离 HOME。该轮曾将操作者已有受管 CLI 启动器指向测试包，已立即通过原安装器恢复到 /Applications/Baton.app；未改任务、认证或其他命令。此修复后重新打包，Electron/安装器/Shell 44 项回归通过，工程检查再次通过。

## 最终安装与复核

- beta.99 最终 `npm run package:mac` 成功生成 DMG/ZIP；codesign --verify --deep --strict 通过，包内关键生产脚本/样式/图标与源码逐字节一致。
- 打包 Electron 验收最终通过：`.data/runtime-settings-t8d6BS/evidence.json`。确认启动自动安装、全新 zsh 不带 endpoint/session 参数且不独立登录即可查询账号；两固定项、启停门禁、两字段抽屉宽窄保存、旧输入拒绝、客户端退出撤销 CLI 均通过。
- 正常刷新真实任务列表确认没有执行中任务后退出并安装到 `/Applications/Baton.app`。最终 asar SHA-256：131dde6a4a03db0a241b827b637b3b43c7adae415b214b38b6ad00e6e217bdd1。临时应用暂存及旧包在启动复核后清理。
- 新服务端口58860。正常界面确认15条已有任务状态及7项待人类处理保持，Runtime仍为原ID的Claude Code（12员工）和Codex（2员工），均启用；实际打开Codex抽屉仅模型/思考两字段，未修改操作者配置。核对真实员工高区分度头像、角色空态、MCP/插件无匹配空态；筛选已清空。打开既有production任务确认标题与完整协作记录仍可读，未确认或重新驱动任何真实业务任务。
- 本机实际 `/bin/zsh -ilc 'baton auth status --json'` 无额外登录成功返回 dengdai68，runtimes list 回读两项；受管命令最终指向 /Applications/Baton.app。
