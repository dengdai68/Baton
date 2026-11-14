---
name: baton-development
description: 在 Baton App 仓库新增功能、修复界面或评审交互时，选择共享组件、品牌 tokens、目录和协作呈现方式，并确定相应验收路径。仅适用于本仓库开发，不用于执行用户的业务任务。
---

# Baton 开发落地

以仓库根为相对路径起点。先读根目录 `AGENTS.md`；它是唯一贡献规则入口，本 skill 只补充产品实现的选型方法。现状和模块入口查 `ai/module-registry.json`、`docs/00-ai-map.md`，不要把本次任务的细节增补成全局规则。

## 界面从现有模式生长

读 `docs/06-design-system.md` 与目标目录 README，再在现有页面找到同类交互。优先延展共享组件及 CSS，所有 renderer 与原生弹窗共用 `web/tokens.css`；Electron 只在 `apps/electron/compact.css` 调整宿主密度；避免某页另定颜色和状态含义。生成头像为身份辨识使用高区分度实色，不限于品牌色；不要把所有头像变成同类浅色。

- 主操作、选中、焦点使用 `--accent` 系列；辅助强调使用 `--accent-cyan`、`--accent-violet`。表面、边框、正文分别用 `--bg-subtle`、`--border`、`--text`/`--text-secondary`。精确值由设计文档及样式维护，不在 skill 复制调色板。
- 员工可用状态不显示徽章，绿点只表示真实执行；Runtime 支持标签使用共享语义样式。支持标签只表达静态兼容，不能暗示实际依赖或账号已验证；失败和待人类处理保留红/琥珀语义及文字。
- 设置页先核对主/子标题字号递减；简单配置优先页内折叠，收起保留草稿。下拉输入与候选区必须连续可悬停，空间允许时展示六项；名称显示的大小写不能改变真实 ID 或提交值。
- 视觉规范以 `.interface-design/system.md`（A · 石墨）为准。新目录先看石墨稿（`redesign/pages/*.html?style=graphite`）的 48px 标题栏（图标+标题+计数+主操作，视图用 `data-title-count` 提供计数）、44px `directory-toolbar`、共享卡片、过滤后分页与独立内容滚动；不显示文档大标题与页面说明。任务、团队、员工、角色与市场共用 `directory-empty` 居中图标/标题/说明，不重复创建入口；加载、读取失败和空列表必须准确区分。不要沿用旧搜索/创建同行和紧凑虚线空态。
- 图标源是 `web/icons/application.png`，说明见 `web/icons/README.md`。替换时保留用户原图，重生成 ICNS 并核对侧栏、Dock/安装包留白与菜单栏原生单色模板；不要再画一份近似标志。导航图标同时检查共享 SVG 与桌面蒙版、`NAVIGATION` 外观偏好。

## 协作与控制台分工

改动协作界面前读设计文档与 `client/README.md`。协作记录供人阅读成员总结、派工、交接和沟通，接收方表示处理对象；已关联消息正文只出现一次，不输出 Provider JSON 信封或平台自动验收文件清单。单一“本轮控制台”连接真实执行证据。

执行错误详情留在控制台对应日志，不叠加长期顶部历史错误提示；成员状态随其最新执行失败/重试/恢复更新。公开思考正文只能来自已保存的公开执行内容，空正文如实解释。长消息先完整渲染安全 Markdown，再裁剪阅读区域；展开保留 DOM、阅读位置和现有分页。

## 选择验证路径

按 `AGENTS.md` 做门禁。纯样式改动用隔离 Electron 实际点击宽窄窗口与两个主题，比较同类组件的最终 computed style，并检查文字对比、键盘焦点、长名称与空态；用本机真实客户端核对现状时不读取认证存储或改造真实任务。

UI/API/CLI 影响判断按 `docs/21-configuration-cli.md`，仅样式和图标变化说明无 CLI 协议影响即可。执行行为改动另按仓库要求验证真实模型完整任务，不把展示夹具当真实执行证据。

选择 `scripts/README.md` 中最贴近改动的验收脚本；品牌和标签检查入口为 `scripts/test-brand-presentation.mjs`。构建与安装按 README/CONTRIBUTING，已有任务运行时不要为视觉检查重启其服务。技能和代码改动不自动授权 push、发布或向团队发送额外消息。
