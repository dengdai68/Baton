# Baton for iPhone

React Native + Expo（SDK 58）重写的 iOS 客户端，连接同一个 Mac 工作空间。底部四个标签：任务、沟通、自动化、更多；标签页不显示标题与数字，顶部只有搜索框和图标操作。

- **任务**：搜索、归档、原生筛选菜单（状态/工作流）与新建在一行；分组 全部 / 待我处理 / 进行中 / 已完成（草稿不在手机上展示，新建任务直接「创建并开始」）。每个任务两行：标题；时间 · 状态 · 当前可做的操作图标。
- **任务空间**：协作记录即页面；顶部图标进入「文件」（工作目录逐级浏览；变更与交付快照按目录树展示，目录可折叠）、「任务详情」（概要、协作焦点、成员及其控制台、描述、验收标准、工作目录）和原生菜单（暂停/继续/归档/恢复/终止/删除）；状态旁只给一个下一步（确认完成、继续或重试）。任务详情的成员可像群聊一样增删：有执行中或待交接投递的员工与当前项目经理锁定并注明原因。
- **控制台**：与 Mac 共用 `client/console-projections.mjs` 投影——调用卡片（Runtime、模型、时间）、提示词快照、连续 Read 合并、Edit 差异、Shell 终端块、思考内容与失败标红一致。
- **沟通**：私聊与群聊，@ 提及、附件与图片（与 Mac 相同的图片判定、内嵌预览、全屏查看与分享），失败回复可图标重试或打开控制台；「会话信息」管理成员、重命名与删除群聊。
- **自动化**：两行（标题；Cron · 状态），启用的在前；详情页与任务详情同一布局：导航标题即自动化名称，状态行（状态 · 下次执行 · 启用开关）、执行规则（可读描述与 Cron）、最近触发与内容描述；顶部图标立即执行、查看触发记录和直接编辑配置。
- **更多**（只读）：数字员工、团队、工作流、角色、插件、MCP 的列表（服务端搜索）与详情页（简介、运行配置、工具、提示词、成员、节点时间线、兼容性、组件、MCP 工具与脱敏配置、使用者）。新建与修改在 Mac 上进行；手机登录会话在网关层就禁止修改这些配置。
- **设置**：顶部是当前连接；二级页面 常规（界面语言、版本）、外观（跟随系统/浅色/深色预览）、工作空间、运行时、CLI、仓库访问、运行日志。「工作空间」只展示当前工作空间信息，退出登录位于设置首页。外观与语言是这台 iPhone 的偏好，其余只读展示 Mac 的设置。

登录时输入账号密码，在登录按钮下方选择或添加工作空间。地址省略协议时使用 HTTPS，明确填写 http:// 时使用明文连接。局域网自签名证书需核对指纹，设备令牌保存在钥匙串。

界面约定：能用图标的操作都用图标（`src/ui/icon-button.tsx`、原生菜单 `src/ui/menu.tsx`），详情与设置页用分组卡片（`src/ui/grouped.tsx`），颜色全部来自 Graphite tokens，浅色与深色同时验收。

## 运行（开发）

```bash
npm ci
npx expo prebuild --platform ios --clean   # 生成 ios/（CNG，勿手改）
npm start                                   # Metro；手机/模拟器装 dev build 后连接
npm run ios                                 # 或直接构建到模拟器
```

native 模块在 `modules/baton-transport`（证书固定的 HTTPS、SSE、上传/下载）。改 Swift 后需重新 `xcodebuild` / `expo run:ios`。

## 测试

```bash
npm test            # 单元测试（登录地址解析等）
npm run typecheck   # tsc
node tests/e2e/run.mjs <steps.json> <out-dir>   # 已装 App 的 UI 驱动（步骤 JSON）
node --test ../../tests/i18n.test.mjs           # 仓库根：手机文案必须有 en / zh-TW 条目
```

E2E 驱动通过 bundle id 驱动已安装的 App；步骤 JSON 支持 launch/activate/tab/tap/tapPoint/type/set/back/swipe/alert/shot/dump 等（`^` 前缀匹配、`~` 包含匹配）。示例：

```json
[{"action":"tab","value":"更多"},{"action":"tap","value":"^数字员工"},{"action":"shot","value":"agents"}]
```

预期：`<out-dir>/agents.png` 为数字员工列表；任一步找不到元素时退出码非 0，并保存 `failure-*.png` 与 `failure-tree.txt`（界面树）。真机或模拟器验收：起隔离工作空间、生成配对链接、打开 App 走完整流程，浅色与深色各看一遍。

## 打包真机

```bash
./package-device.sh build/BatonMobile.ipa
```

用 Xcode 组织 `Baton.xcworkspace`（scheme Baton）或直接_archive_ 出 IPA；开发签名 IPA 仅可装到描述文件授权的设备。首次安装如提示未受信任开发者，在 iPhone「设置 → 通用 → VPN 与设备管理」中信任。

## 结构

- `src/app/` Expo Router 路由；`(workspace)/` 为底部标签页（任务、沟通、自动化、更多），`task/`、`chat/`、`automation/`、`directory/`、`settings/` 为推入的详情页。
- `src/ui` Graphite 组件：图标按钮、原生菜单、分组卡片、搜索工具栏、图片查看器等（色板由 `scripts/build-tokens.mjs` 从 `web/tokens.css` 生成）。
- `src/lib/file-tree.ts` 把扁平路径列表展开为可折叠目录树（文件、变更、快照共用；`tests/file-tree.test.ts`）。
- `src/features` 各业务能力：`tasks`、`workspace`（协作、文件、控制台、详情）、`chats`、`messages`（消息与附件）、`automations`、`directory`（更多的只读数据与详情视图）、`settings.tsx`（Mac 设置的只读读取）。
- `src/api` 网关客户端（Bearer + 证书固定 + SSE）；工作空间关闭后，仍在卸载的页面请求会失败而不是崩溃。
- `src/i18n` 复用 `client/i18n.mjs` 与 `client/locales/*.json`（简中源文本）。

前台共用一个工作空间实时订阅。设置显示当前工作空间，退出登录后可连接其他地址。

登录页可添加、选择工作空间地址并检查连接。更多页显示当前账号，工作空间详情位于设置。
