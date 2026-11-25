# 配置目录与工作目录

扩展目录增加只读使用筛选 `usage=all|unused`，默认 all。Store 汇总当前未删除员工的直接扩展选择与当前角色选择，传入配置目录查询的排除 ID 集合；搜索与排除先于排序后分页，不新增存储字段、迁移或执行状态。业务存储不可用时拒绝 unused，不将未知引用显示为空。App 与 CLI plugins/mcps list --usage 共用相同结果。

## 决策

只有两个用户可理解的根：配置目录 `~/.baton`，工作目录由用户设置，默认 `~/.baton/workspace`。源码开发使用独立的 `workspace-dev` 和 `desktop-dev` 配置命名空间，不得与正式实例共用清除范围。配置目录不随工作目录更换而搬迁。

`storage.json` 保存工作根 `workspaceRoot` 和冻结扩展地址元数据。`workspaceRoot/records` 保存执行文件。业务数据库和派生历史索引固定在配置根的 `sqlite/`，源码开发使用 `~/.baton/desktop-dev/sqlite/`。App 和 CLI 的 `businessRoot` 和 `databasePath` 是只读定位信息。

```json
{"version":1,"workspaceRoot":"/absolute/workspace","previousRuntimeRoots":[]}
```

废弃的 `businessRoot` 配置明确拒绝，不在启动时兼容或静默修正；旧开发实例需重新初始化定位。真实实例只可在用户授权的停机整理中，先确认其旧记录路径与推导路径完全一致，再移除冗余字段，保留其他元数据和全部业务文件。

```text
~/.baton/
  storage.json                     # 工作目录定位，启动唯一来源
  configuration.json               # Runtime 设置、插件/MCP 摘要清单与软删除标记
  runtime-configs/                  # 导入插件、MCP 原文和不可变执行配置
  credentials/                     # Git 凭据
  auth.sqlite                      # 登录、认证、会话
  sqlite/
    baton.sqlite                   # 员工、角色、团队、工作流、任务、自动化与沟通元数据
    baton.sqlite.history.sqlite    # 派生历史索引，SQLite 日志和共享内存文件也位于此目录
  desktop-preferences.json          # 界面偏好
  desktop-endpoint.json             # CLI 发现当前宿主，不包含登录凭据
  desktop-cli-session.json          # 宿主委托给 CLI 的私有授权
  browser/                         # 本机认证浏览器资料
  updates/                         # 已验证更新缓存
  desktop-dev/                     # 源码开发的独立配置，不与正式实例混用
  logs/                            # 当前实例诊断日志
  workspace/                       # 未配置时的默认工作目录

<工作目录>/
  records/                         # Run Files 的根
    runs/<RunID>/                  # 任务 Trace、正文、提示词、快照、附件和产物
    communications/<会话ID>/       # 沟通提示词、执行输出、正文与历史内容引用
  tasks/<TaskID>/<RunID>/           # 普通/自动化任务的员工 cwd、业务工作文件
  communications/<会话ID>/         # 私聊/群聊成员共享 cwd、业务文件
    attachments/<附件ID>/<原文件名> # 上传附件；模型和成员在共享 cwd 中可见
```

账号、凭据不返回目录查询；原生 CLI 自主管理的全局登录位置由 Provider 决定，本应用不复制其凭据。员工/角色的扩展关联是业务事实，保存在业务数据库；插件/MCP 清单和设置的主数据只在 JSON，源内容在配置目录文件。冻结任务继续保留自己的运行配置、内容摘要和会话，不重写历史。

## 本次配置目录调整

安装版首次启动、打开认证库和持久浏览器资料之前，将用户已授权的旧 `~/.baton/desktop` 配置搬到 `~/.baton`。先确认旧宿主与后台已退出，再逐项同盘 rename；认证库及其侧文件、登录浏览器、偏好、Runtime/插件/MCP、Git 凭据和更新缓存保留原字节。业务工作目录、数据库、任务、沟通和执行内容不搬迁、不重置。开发实例仍使用 `desktop-dev`，显式隔离配置根不参与搬迁。

私有 `.configuration-root-migration.json` 记录目标和原 inode 身份，中断后继续；同名配置、活动旧实例、链接和不可信记录明确拒绝，不合并或覆盖另一份配置，也不启动空实例。完成后移除旧空目录和迁移记录，不建立自动备份。`storage.json` 保留原工作目录，并追加旧 `desktop/runtime-configs` 地址到 `previousRuntimeRoots`，让冻结扩展引用在读取边界映射到新位置；不改写配置清单、业务快照或提示词。

CLI 默认连接 `~/.baton/desktop-endpoint.json` 并读取同目录宿主委托授权；不回退旧目录，不直接迁移配置或读取认证数据库。安装版完成搬迁并启动后，App 与 CLI 的 `storage get` 返回同一个 `configurationRoot`。本次仅为已授权的目录调整，不引入旧配置内容协议兼容。

验收使用 `scripts/test-configuration-root.mjs`，通过 `BATON_CONFIG_OLD_APP` / `BATON_CONFIG_NEW_APP` 指定旧、新打包客户端。隔离 HOME 先在旧版登录，再验证升级保留登录、偏好、MCP、冻结 Run 和沟通记录，CLI 默认连接新根；同时覆盖活动旧实例和目标冲突拒绝，重复启动不再创建 `desktop`。

## JSON 与业务事务

JSON 清单由 `server/configuration-store.mjs` 负责，启动读取并缓存，列表按名称搜索、排序后分页，不扫描扩展目录。Store 仍拥有领域规则。更改扩展同时解绑员工/角色时，需要跨 JSON 与 SQLite 提交：先把 JSON 候选写入私有 pending 文件并 fsync，随后在业务 SQLite 事务中只写入候选 revision 指针，再提交业务变更，最后原子替换当前 JSON。SQLite 不存清单正文或 Runtime 主设置。

启动按已提交 revision 完成或丢弃 pending：提交前失败不改变配置或绑定；提交后发布失败明确报告“已提交、需重启恢复”，禁止后续写入，不能回滚已提交业务状态或提示调用者盲目重发。pending 标识原业务数据库，另一个工作区不得接管未结束的配置提交。没有配置变更的业务事件不重写 JSON。

这是当前协议，不提供旧配置格式自动迁移、备份或静默初始化。遇到旧 SQLite 清单明确拒绝启动。旧协议的开发数据需要重新初始化；真实实例只能按用户明确授权执行停机整理，不得在启动时隐式改写。已采用 JSON 清单的实例更换记录位置时只搬业务资料，不再导出或改写配置清单，也不清除业务实例。

## 更换工作目录

App 和 CLI 通过同一认证 HTTP 更换工作目录，实例忙碌时拒绝。宿主将 Run Files 拷贝到目标盘的临时目录，逐文件校验 SHA-256，再切换 `storage.json`。新服务健康后清除旧执行文件副本。SQLite、历史索引和配置目录固定在原位置。无法访问原数据盘时报告错误。

已有任务的实际路径保持冻结；更换目录影响新任务。受管扩展旧物理地址仅在读取和调用边界映射，不改变提示词、SHA、Trace、原生会话。更换目录前必须完成任何 pending 配置提交或数据清除。

## 清除所有数据

客户端经当前密码及明确文字确认后清除整个当前工作目录及固定 SQLite 路径的业务主库、历史索引和关联文件。保留账号、登录、Runtime 设置、插件/MCP 清单与源文件、Git 凭据、偏好和诊断日志。随后重新创建业务数据库和工作目录。

清除意图写在配置目录，删除中断后启动继续完成。清除期间保留工作目录和 `records` 目录本身，宿主可使用原定位重新启动。不跟随工作目录符号链接，不允许清除 Home、配置目录、仓库或它们的祖先。配置根内只允许专用 `workspace` / `workspace-dev` 业务子树作为工作目录；清除这些目录不包含同级的认证、浏览器、凭据、Runtime 或日志。其他配置子目录仍受保护。历史冻结在当前工作目录之外的旧任务文件不扩展删除范围。真实实例整理不调用清除功能。

## 员工进程启动目录

新建普通任务和自动化任务统一分配 `<工作目录>/tasks/<TaskID>/<RunID>`。同一 Run 的经理和员工共享该目录，原生会话仍按成员隔离；已有任务的冻结目录不重写。App 与 CLI 走同一 Store 分配，不接受用户手工拼装内部目录。

私聊和群聊首次执行时由 Store 分配 `<工作目录>/communications/<会话ID>`，持久记录 conversation.workspacePath。群聊全员使用同一 cwd，可以通过相对文件名共享文件；不同会话隔离目录，每个成员仍有独立原生会话、输入游标及串行队列。更换工作根后，已分配的沟通目录和其文件保持原位，后续会话才使用新根。

工作根的 `records` 保存任务与沟通的正文、不可变提示词和执行输出。SQLite 存沟通消息、会话与执行元数据。内容引用使用逻辑相对路径，读取时验证字节数与 SHA-256。沟通附件保存在共享 cwd 的 `attachments` 下。更换工作根时移动 Run Files，已分配的沟通 cwd 和附件通过 Store 的冻结路径读取。

旧版本把业务库放在 `records`。升级旧实例时先退出 Baton，将已验证的业务数据库放入配置根的 `sqlite/`，使用该库对应的 WAL（如有未合并事务）。历史索引可重建。启动时发现旧库而缺少新库会报告业务数据未就绪。手动切换数据库时保留现有工作目录和全部 Run Files。

## 配置读取与业务打开

登录、health、`bootstrap?view=connection`、工作目录定位、日志列表、Git 凭据状态及插件/MCP清单读取不要求先打开业务 SQLite。清单使用 `configuration.json` 的只读视图，不扫描扩展文件；检测到 `configuration.pending.json` 时拒绝只读恢复，由业务初始化核对数据库 revision 后处理。涉及员工/角色关联的详情、配置写入与执行仍通过原 Store 事务。运行中的 Store 是配置清单的最新读源，数据库失败不影响独立配置文件读取。


Baton 当前业务库位于 `~/.baton/sqlite/baton.sqlite`。配置和工作目录的历史背景见 [Baton 身份切换](development/baton-identity-cutover.md)。

界面语言偏好与关闭行为、外观一起保存在配置根的 `desktop-preferences.json`（`language` 键），属于宿主界面偏好，不进入业务数据库；清除工作目录不影响该偏好。
