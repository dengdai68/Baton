# 设置层级与 Runtime 页内编辑

目标：修正设置主/子标题层级、Runtime 编辑位置，以及模型下拉的尺寸和鼠标衔接。范围仅 renderer/桌面样式与对应验收；HTTP/CLI 字段、Runtime 调用、任务状态和冻结快照不变，不重复消耗模型额度。

## 事实与实现

安装版 beta.99 的 Runtime 使用右侧 dialog，模型建议列表仅160px；仓库访问 h4=16px、Runtime h4=15px，而桌面设置 h3=15px。下拉 top=100%+5px 与 mouseleave 关闭组合，使鼠标经过空隙提前收起。

- renderer 设置 h3/h4 为20/16px，桌面为15/13px，共用层级适用于仓库访问、Runtime及其他设置子标题。
- 固定 Provider 的开关保留在收起状态可操作；配置使用原生 details 默认关闭，展开时首次创建两字段表单，收起不删除表单或草稿。不再创建 Runtime dialog/抽屉。
- 模型输入区最大560px，列表与输入底边相接并略有1px重叠，无空白鼠标断点。单项36px，菜单最大226px，可完整显示六项；更多项在列表内滚动。保留鼠标移出、外部点击、失焦、Escape和方向键选择。
- 模型/思考选项仅展示标签首字母大写；input/option值及保存请求保持 Provider 原始 ID，不修改 API/CLI 协议。
- 开关更新时同步已展开表单的测试按钮可用状态；关闭后不留下可见模型浮层。

## 验证

`npm test`：545 pass / 0 fail。规定语法检查、check:ai/check:impact、git diff --check通过。首次单测发现旧静态样式断言仍依赖已废弃的 Runtime 专用字号，更新为共享设置层级后全量通过。

`scripts/test-runtime-settings.mjs` 扩展两主题/1320及760px实际 Electron检查：默认折叠、无dialog、仓库与Runtime子标题小于主标题、六个可见模型、鼠标跨原间隙后选择第六项、显示首字母及原始值、折叠后DOM和草稿保留、键盘重新展开、保存回读与既有开关/授权回归。

首次窗口启动超时未形成UI结论（.data/runtime-settings-6C37kg）；第二次已完成四种布局检查，但最后清空模型后尚开着建议列表，自动点击保存被列表阻挡。修正测试为按Escape收起建议后保存，保留失败记录 .data/runtime-settings-A84uwT；不把该轮记为整体PASS。

源码UI最终通过：`.data/runtime-settings-5wi4Mf/evidence.json`，含两主题宽窄布局、标题字号计算、鼠标跨边界并选第六项、模型显示/原值区分、折叠DOM保留及HTTP/CLI回读。已目检 inline-minimal-760.png，表单与主/子标题清晰、无横向溢出。

## 追加：二级配置密度与直接任务操作

本机 beta.99 再次核对：仓库配置使用多层卡片与较大上下留白；任务“更多”有时仅一项删除。按追加要求，compact.css 将 Runtime/仓库改为适度紧凑的二级分隔组；renderTasks 直接渲染现有允许按钮，移除菜单及其全局监听，保留所有原命令、确认与 Store 门禁。只影响呈现，CLI 无协议变化。

上轮 beta.100 打包版验收已通过：`.data/runtime-settings-Uo92Qp/evidence.json`，但安装前收到追加要求，因此该包未安装，暂存包不作为最终交付。此次修改将重新打包并复测。

追加源码验收通过：`.data/runtime-settings-urSCRT/evidence.json`。已目检760px仓库页、Runtime展开页和任务操作列，二级标题与分组明确，按钮完整可见。两主题/1320及760px归档恢复往返及删除确认通过，未执行任何真实实例删除或任务运行。此前两次新增展示夹具初始化失败，是未依次经过 running/review 的测试数据准备错误；按真实状态转换修正后通过，未放宽产品状态机。首次全量检查还发现旧“更多”静态断言，已同步为直接操作呈现。

追加改动的全量 `npm test` 再次通过：545 pass / 0 fail（`/private/tmp/agentforge-settings-density-tests2.log`）；check:ai、check:impact、规定语法检查及 diff --check 全部通过。

最终打包验收通过：`.data/runtime-settings-Bw9Ym2/evidence.json`，包含两主题宽窄界面、下拉衔接、直接操作、确认流程以及 CLI 自动安装/客户端授权回归。macOS arm64 ZIP/DMG 已生成，签名完整性通过，asar 中四个修改的界面文件与源码逐字节一致。

已安装 `/Applications/AgentForge.app` beta.100；asar SHA256：`a68ea624bc8663aaf2226cb324deb6219a193343fac7abca07d41f4c1968c7c2`。实机通过客户端核对默认折叠、页内展开、六个可见大写模型标签、仓库主/子标题及分隔布局、真实任务列表直接按钮。仅查看配置和列表，未保存 Runtime/Token 或修改真实任务。更新前确认无执行中任务，正常退出并替换应用；正式只读 CLI 更新前后15个 Task ID摘要与状态分布一致（6待验收、3已终止、1阻塞、5完成），客户端登录保留。暂存副本已清理。
