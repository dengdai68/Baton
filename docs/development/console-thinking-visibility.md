# 控制台公开思考内容展示

日期：2026-10-31；目标版本0.1.1-beta.97。

Outcome：展示 Provider 已提供并保存的公开 thinking 正文，说明没有正文的历史行，避免“已脱敏”成为空白内容的误导标签。

Evidence：安装版 beta.96 的真实 run_mvvmd2kg_2，媒体准备成员同时有正常公开思考和仅“已脱敏”的空行，质检成员也有正常正文。代码 executionContent 对过滤后文本 trim，再将结果与原文比较，只有空白被清理也会 redacted=true；renderer 对空正文生成空 pre 加脱敏标签。两者共同造成空行误导。

Scope：executionContent 仅修正展示元数据（以规范化空白后的原文比较）；renderer 保留公开正文及其余安全文字，将实际过滤提示改为“敏感片段已隐藏”；空历史正文显示“此条记录未保存可显示的思考正文”。字段与端点不变，CLI 无执行正文读取命令，已核对无需新增命令/参数/schema。Provider 调用、思考等级、凭据/提示词过滤、调度、Store、历史事实不变。

Non-goals：不恢复未保存正文，不获取隐藏/加密思考，不重跑或确认真实任务，不读取认证/领域数据库。

验证进度：相关 settings/runtime-configuration 单元测试71项通过；源码隔离 Electron 验收通过，证据 .data/collaboration-flow-sn6day，包含真实 DOM 中公开正文可见、空历史正文说明、敏感片段过滤后其余文字仍在及截图。check:ai/check:impact、规定语法检查和 git diff --check 通过。全量 npm test：543 pass / 0 fail。打包版隔离验收通过，证据 .data/collaboration-flow-71S3cZ。DMG/ZIP 构建成功，codesign --verify --deep --strict 通过；asar 内 app.js/local-cli.mjs/styles.css/console-projections.mjs SHA-256 与受测源码一致。已安装 beta.97，安装版签名与 /api/health 正常。


安装后实机复查：同一 run_mvvmd2kg_2，媒体准备控制台已加载到用户指定的10:06:17、10:06:20、10:06:22、10:06:24记录，这些行当前没有可显示的保存正文，现明确提示未保存，不再只标“已脱敏”。同时目视确认10:09:40的公开思考正文完整可读，以及10:07:44的简短思考正文。客户端留在原时间段，任务保持待人类验收，其他任务名称/状态未变；未重跑、确认或终止任务。

限制：既有不可变记录中没有保存的正文无法从当前记录补出；本轮不推测其原始内容。未再次调用模型；本轮修改不涉及执行流程、Provider 协议或隐私过滤规则。采用现有 ad-hoc 签名，未做 Apple notarization。
