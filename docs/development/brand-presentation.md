# 品牌与目录视觉统一

本轮只调整呈现、应用图标和仓库开发辅助 Skill。未改变员工配置协议、任务状态机、Runtime 调度或 HTTP/CLI 输入输出。保留本轮之前已有的未提交协作与控制台修改，不创建提交或远程发布。

## 现状与改动

通过 /Applications/AgentForge.app 的正常客户端核对角色空态、员工目录、插件支持标签和搜索无匹配状态。原桌面主色为黑灰，员工可用保留旧绿色，Runtime 标签使用另一组青绿；空态只依靠部分共享声明，没有明确收敛边框和间距。

以用户新图标的蓝/青/紫为品牌来源，主按钮、选中和焦点统一蓝色；可用与静态支持标签同色，停用和不兼容保持中性。头像改为成对的低饱和底色/深色字，保留红色错误和琥珀待处理语义。角色、MCP、插件空态明确共用实线边框、背景、文字、圆角和间距，两个主题只改变中性表面。

web/icons/application.png 原样替换用户附件，SHA-256：1763dd36540f3c9d298440ea0e99e83b5a2dba464955504d685da34426be0308。ICNS 经现有 sips/iconutil 脚本重生成。侧栏、Dock、安装包、菜单栏同源；新图标带不透明深色底板，因此菜单栏使用彩色缩略图，避免 alpha 模板呈现实心方块。原生确认窗口独立加载 compact.css，保留相同品牌的 action/focus 默认值。

.codex/skills/agentforge-development/SKILL.md 作为仓库开发辅助入口，AGENTS 链接其用法；它将后续功能/界面开发路由到共享模式与验收脚本，不复制维护贡献规则或调色板事实，不进入 Runtime 员工插件或安装包。目录边界说明写入 docs/02，设计事实写入 docs/06。

## 已完成验证

- npm test：543 pass / 0 fail。
- node --test tests/electron.test.mjs tests/settings.test.mjs：80 pass / 0 fail（包含最新宿主和偏好修改）。
- check:ai、check:impact、规定语法检查、git diff --check：通过。
- skill-creator quick_validate.py：通过。
- node scripts/build-app-icon.cjs：成功；品牌单测核对新 PNG 哈希与 ICNS 格式及宿主资源引用。
- node scripts/test-brand-presentation.mjs：源码隔离 Electron 两主题、1320/760px 通过，证据 .data/brand-presentation-qHD8P2。真实点击搜索、详情与键盘焦点，比较三个目录最终 computed style，检查按钮/支持与不兼容/空态/头像文字对比度及页面溢出；真实 HTTP 503 验证读取失败不误报空列表。已查看员工、插件和窄屏角色截图。
- 前两次验收未进入展示断言：测试插件名称误用了中文（不符合插件协议）、MCP 夹具缺少必填说明。修正夹具后重跑通过，没有修改产品输入规则。

## 交付边界

版本 beta.98。npm run package:mac 已成功生成 DMG/ZIP，codesign --verify --deep --strict 通过，包内 web/styles.css、web/app.js、compact.css、main.mjs、PNG/ICNS 字节与源码一致。安装包界面完整重跑通过，证据 `.data/brand-presentation-rjeehq`，含两主题/宽窄、三目录、状态标签和独立加载 compact.css 的原生确认 HTML。首轮包内测试在原生窗口预览接线处失败，未作为通过结论；改为隔离预览实际 HTML 后重跑通过。无 Provider 执行变化，本轮不重复调用模型；展示脚本使用隔离目录和明确夹具，不能作为真实模型验证证据。CLI 无协议或能力变化，因此无需制造命令/帮助/schema 变动。


## 本机安装与真实复核

已通过正常退出、暂存/签名与哈希核对、应用目录替换、重新启动的方式安装 beta.98。安装路径 /Applications/AgentForge.app；asar SHA-256 d7f02a8f358baaa43e79b929655bb3e693900537ea1c8135c992dd5ac8f61eca。临时安装目录在成功启动复核后清理，没有改动任务库、工作目录或认证配置。

通过真实客户端复核员工蓝色可用标签、实际安装插件的 Claude/Codex 支持标签、角色未创建空态以及 MCP/插件搜索无匹配区域的背景与实线边框；搜索核对后清空。新服务端口58863，已有任务、成员与插件配置正常载入。

安装发生一次操作疏漏：更新前读取的是未刷新的任务列表，没有显示19:46新创建的两条 MiniMax 独立验证任务。19:51:48重启触发了它们的中断恢复，历史 Trace 保留、未完成投递重新排队。已在界面确认两个对应执行成员进入新的第二次 Trace、显示执行中；截至本轮复核未看到新 Trace 的后续工具输出，不声称它们已完成业务验证。未向团队发送额外消息、未手动重试或改动这些任务。
