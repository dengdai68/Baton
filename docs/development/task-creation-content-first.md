# 新建任务内容优先

目标：让任务标题和内容成为创建弹框的主体；验收标准选填、默认折叠，团队与流程固定在底部一行，工作根仅小字。现状证据来自本机 beta.100 新建任务界面：执行说明、经理说明与流程节点详情同时展开，目标描述只有很小的默认输入区域。

范围：renderer 创建表单、共享弹框布局、桌面密度和相关验证/契约。移除 taskAssignmentMarkup/syncTaskAssignments 只删除预览说明，原本就未提交节点预分配；未改变 Store、HTTP/CLI 输入输出、任务冻结、派工、Runtime 权限或启动语义。无需新增 CLI 能力。

实现：独立 task-create-modal 复用原弹框宿主与分组，标题及内容在主编辑区；textarea 随剩余高度伸展，至少六行，大窗口不少于弹框60%。验收标准使用原生 details，收起不销毁内容，校验错误会展开。底部同排业务团队/流程模板、工作目录小字及提交操作固定可见。短窗口展开验收时只有正文滚动。去除执行说明、经理/成员/节点预览。

验证：`npm test` 545 pass / 0 fail；check:ai/check:impact、规定语法检查、git diff --check 通过。旧创建表单静态断言和既有 Electron/打包脚本同步为折叠验收及无说明预览。完整 E2E 由 `scripts/test-task-creation.mjs` 验证：隔离 HOME/数据；两主题、大/窄/短窗口，六行与大窗口占比，底部同排和可达，必填/过多验收错误、折叠草稿保留、真实 HTTP 创建、所选团队/流程与验收落库；故意拒绝启动请求，确认待开始任务保留，未把展示夹具当 Provider 证据。

初次布局实测发现桌面 html:root 嵌套的 .modal-scroll 仍以更高优先级覆盖 display:flex，内容区未随剩余空间长大，两轮占比检查失败（.data/task-creation-1VSHem、.data/task-creation-cdBKQn）。按宿主现有锚定方式修正 display 与六行最小高度，并在测试测量前完成弹框动画，保留失败证据。

源码最终验收通过：`.data/task-creation-tOKg7a/evidence.json`，两主题三种窗口共六组真实界面与创建/失败路径。已目检大窗口及800×560短窗口，内容优先、六行输入与底部选择/提交可达。补充测试修正：bootstrap只返回任务摘要，不含验收标准；误用单对象GET也返回404，最终按既有正式 `/api/tasks` 详情集合回读，无需改动API或产品。上述失败保留在对应隔离证据目录。

补充动画检查后，源码再次通过（`.data/task-creation-27jVRo/evidence.json`）；beta.101 打包版同样通过六组布局、创建与失败路径（`.data/task-creation-NMpVoh/evidence.json`），目检大窗口及短窗口截图。截图前结束有限动画，避免把祖先淡入过程误当最终界面。

交付：`npm run package:mac` 成功生成 beta.101 ARM64 ZIP/DMG；应用通过 codesign 深度严格验证，打包内 app.js/styles.css/compact.css 与源码一致。已正常退出旧客户端、更新 `/Applications/AgentForge.app` 并启动新版本，通过客户端实际核对新表单；保留并恢复更新前未提交的验收草稿。更新前后正式 CLI 只读查询均为 15 个任务（6 待验收、3 取消、1 阻塞、5 完成），ID 集合摘要一致，登录延续，无真实任务变更。安装包为本机 ad-hoc 签名，未作公证或远程发布。

CLI 核对：本轮只调整创建表单的展示和可选验收折叠，不改变 HTTP 输入、任务/Run 语义或 CLI 已有字段；CLI 无需协议改动。启动失败保留任务的路径已在隔离界面验收，未重复调用真实 Provider。

后续调整（beta.102）：按用户新要求替代大窗口60%规则，描述高度在六至十二行之间响应窗口，最高十二行，更多文本在框内滚动；弹框随内容收紧。协作正文折叠阈值由五行改为十行，保留完整 Markdown DOM、原位展开及阅读状态。只变呈现，不改消息、任务、CLI 或执行协议。同步现有两项 UI 验收的行数断言。

本轮初次源码 UI 进程在 electron.launch 阶段分别遇到90秒/180秒超时，尚未进入布局验收（原始日志 `/private/tmp/agentforge-beta102-task-creation-source.log`、`/private/tmp/agentforge-beta102-collaboration-source.log`），同时构建启动与 MCP 测试子进程明显变慢；构建采样显示主线程在模块文件 open/read/stat 中。保留失败日志，减少并行 UI 并重试，不把超时当通过。

beta.102 最终验证：源码目录完整测试为543通过、2超时（owned service 启动30秒、MCP request60秒）；同一份文件复制至本机临时目录后执行 `npm test`，545通过、0失败，耗时47.9秒（`/private/tmp/agentforge-beta102-tests-local.log`）。源码 UI 重试进入宿主后，后台30秒启动超时，未形成布局结论；未修改产品超时/重试来掩盖环境问题。

本机签名应用副本的创建验收通过：`.data/task-creation-VsZAgT/evidence.json`（两主题、三种窗口、六至十二行和真实 HTTP 创建/启动拒绝）；协作验收通过：`.data/collaboration-flow-uQW8Vo`（十行裁剪、完整 Markdown、同 DOM 展开和状态保留、宽窄布局、控制台及 CLI）。README 同步后逐一核对包内103个项目文件与源码一致。check:ai/check:impact、规定语法与 diff 检查通过。

安装方式如实记录：本轮标准 `npm run package:mac` 因开发盘读盘极慢而停止（退出143，日志 `/private/tmp/agentforge-beta102-package.log`），未生成可交付的beta.102 ZIP/DMG。为完成本机 UI 更新，在本机临时目录复用已安装beta.101的Electron/依赖，重打包当前renderer/版本及关联README，沿用原entitlements并重新ad-hoc签名；103个项目文件一致、深度严格签名验证通过后安装为 `/Applications/AgentForge.app` beta.102。未发布Release。启动后客户端保持登录、真实任务列表可见；用户正在持续操作设置，自动化多次拒绝切页，因此本轮新布局的直接操作证据来自同源签名副本，不声称在真实任务上完成新版本的展开测试。

更新后正式CLI只读查询与更新前相同：15任务、状态计数和ID集合摘要完全一致。安装前最后一次界面出现Codex思考等级High的未保存草稿；退出检查只识别文本输入而漏掉下拉草稿，重启后该选项恢复为已保存的默认值。此草稿未能保留，未擅自修改真实Runtime配置；因用户继续操作设置，不覆盖其后续输入，交付时如实提示重新选择。
