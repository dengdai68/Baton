# 目录空态与同步状态位置

目标：同步状态位于侧栏登录信息旁；搜索无结果和目录未创建提示统一样式，左右边缘与整个列表或整行卡片对齐，降低提示区高度。

事实：本机 beta.104 顶栏展示实时同步；代码中任务/团队使用带不同 margin 的 empty-state，角色和市场使用40px内边距的另一套样式，员工空态位于多列网格内，造成边框、宽度和高度不一致。

改动：共享 directory-empty 使用主题背景/文字、1px虚线边框、6px圆角、14px 16px内边距和零外边距；网格中跨所有列。任务、团队、工作流、员工、角色、MCP/插件及沟通选择器共用，沟通会话列表空态也采用此样式。标题与说明统一排布，保留工具栏创建入口。加载和读取错误仍有真实文案，错误使用alert，不显示成无结果。同步节点仍只有一个，移到账号旁，连接/断开沿用任务SSE事件更新；初次未订阅使用中性圆点和明确可访问名称。窄侧栏只显示圆点，长账号名省略，不挤出状态。

范围仅renderer呈现及Electron响应式覆盖；未改变HTTP/CLI、认证、SSE订阅时机、执行协调、任务及消息数据。CLI核对无参数、输出、help或schema变化。同步设计文档、地图、注册表、README、CHANGELOG及仓库开发skill，移除旧空态约定。

验证：同一工作树复制到本机临时目录执行npm test，546通过、0失败；check:ai/check:impact、规定server/app语法检查、communication/marketplace及验收脚本语法检查、git diff --check通过。现有隔离Electron品牌验收扩展到8种目录，两主题×1320/760窗口逐项比较computed style和左右边缘，误差小于1px，常规两行提示不超过80px，无页面横向溢出；角色原始空列表、搜索无结果、市场HTTP503读取失败、状态在账号区且顶栏无重复、长账号及窄侧栏均通过。截图已目检。证据：本机临时验证目录.data/brand-presentation-TD6Htv/evidence.json；日志/private/tmp/agentforge-beta105-presentation.log。均使用隔离数据，未调用Provider。

打包为beta.105本机候选应用：复用已安装Electron和生产依赖，覆盖105个项目文件并逐文件比对，沿用entitlements并ad-hoc签名，codesign深度严格校验通过。候选位置记录于/private/tmp/agentforge-beta105-preview-path。本轮未发布GitHub Release或生成标准ZIP/DMG。

安装已完成：用户暂停任务并明确要求安装后，正式CLI与客户端均确认已暂停、无正在执行任务；正常退出并将beta.105安装到/Applications/AgentForge.app，签名与ASAR哈希核对通过。启动后首轮正式CLI对比15个任务ID与状态均一致，客户端登录保留。实机AX与截图确认同步状态位于账号旁、顶栏无重复。随后实机显示该任务已继续执行，安装操作未发送恢复任务命令，未再干预。目录空态两主题宽窄布局已在同版本隔离候选应用验收，实际客户端本轮未额外筛选目录。未提交或推送当前混合工作树。
