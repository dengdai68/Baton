# Baton for iPhone 与 Android

Android 的沟通和协作记录根据系统键盘实际遮挡范围调整输入区。iPhone 与 Android 的任务列表支持搜索、快捷分组和状态筛选。

| 目录或入口 | 用途 |
| --- | --- |
| [src/](src/README.md) | 路由、界面、接口调用和工作空间会话 |
| [modules/baton-transport/](modules/baton-transport/README.md) | Swift 和 Kotlin 原生网络实现 |
| [assets/](assets/README.md) | 应用图标与启动图 |
| [scripts/](scripts/README.md) | 生成共享界面 token |
| [tests/](tests/README.md) | 单元测试和真机验收入口 |
| `app.json`、`package.json`、`package-lock.json` | Expo 配置、命令和依赖版本 |
| `ios/`、`android/`、`build/` | 本机生成的原生工程和安装包 |

详情首次加载时，指示器居中显示在导航栏下方的内容区域。列表分页在列表内提示。沟通和协作记录仅在相邻消息之间绘制分隔线。

React Native + Expo（SDK 58）重写的手机客户端：iOS 与 Android 共用同一套代码和全部功能，连接同一个 Mac 工作空间。底部四个标签：任务、沟通、自动化、更多；标签页不显示标题与数字，顶部只有搜索框和图标操作。

- **任务**：搜索、归档、原生筛选菜单（状态）与新建在一行；分组 全部 / 待我处理 / 进行中 / 已完成（草稿不在手机上展示，新建任务直接「创建并开始」）。每个任务两行：标题；时间 · 状态 · 当前可做的操作图标。
- **任务空间**：协作记录即页面；顶部图标进入「文件」（工作目录逐级浏览；变更与交付快照按目录树展示，目录可折叠）、「任务详情」（概要、协作焦点、成员及其控制台、描述、验收标准、工作目录）和原生菜单（暂停/继续/归档/恢复/终止/删除）；状态旁只给一个下一步（确认完成、继续或重试）。任务详情的成员可像群聊一样增删：有执行中或待交接投递的员工与当前项目经理锁定并注明原因。
- **控制台**：与 Mac 共用 `client/console-projections.mjs` 投影——调用卡片（Runtime、模型、时间）、提示词快照、连续 Read 合并、Edit 差异、Shell 终端块、思考内容与失败标红一致。
- **沟通**：私聊与群聊，@ 提及、附件与图片（与 Mac 相同的图片判定、内嵌预览、全屏查看与分享），失败回复可图标重试或打开控制台；「会话信息」管理成员、重命名与删除群聊。
- **自动化**：两行（标题；Cron · 状态），启用的在前；详情页与任务详情同一布局：导航标题即自动化名称，状态行（状态 · 下次执行 · 启用开关）、执行规则（可读描述与 Cron）、最近触发与内容描述；顶部图标立即执行、查看触发记录和直接编辑配置。
- **更多**（只读）：数字员工、团队、工作流、角色、插件、MCP 的列表（服务端搜索）与详情页（简介、运行配置、工具、提示词、成员、节点时间线、兼容性、组件、MCP 工具与脱敏配置、使用者）。新建与修改在 Mac 上进行；手机登录会话在网关层就禁止修改这些配置。
- **设置**：顶部是当前连接；二级页面 常规（界面语言、版本）、外观（跟随系统/浅色/深色预览）、工作空间、运行时、CLI、仓库访问、运行日志。「工作空间」只展示当前工作空间信息，退出登录位于设置首页。外观与语言是这台手机的偏好，其余只读展示 Mac 的设置。

登录时输入账号密码，在登录按钮下方选择或添加工作空间。地址省略协议时使用 HTTPS，明确填写 http:// 时使用明文连接。局域网自签名证书需核对指纹，设备令牌保存在钥匙串（Android 为 Keystore 加密存储）。

界面约定：能用图标的操作都用图标（`src/ui/icon-button.tsx`、原生菜单 `src/ui/menu.tsx`），详情与设置页用分组卡片（`src/ui/grouped.tsx`），颜色全部来自 Graphite tokens，浅色与深色同时验收。

### Android 与 iOS 的对应

功能一致，交互按平台使用系统控件；平台分支集中在 `src/ui`，页面只调用共用接口：

| 能力 | iOS | Android |
| --- | --- | --- |
| 导航栏按钮 | iOS 26 栏按钮（`unstable_header*Items`） | 工具栏视图（`headerLeft/Right`），由 `src/ui/header.tsx` 的 `headerRightOptions` / `headerLeftOptions` 统一生成 |
| 筛选与更多菜单 | SwiftUI Menu（SF Symbol 图标） | Material 3 下拉菜单（只显示文字、勾选与红色危险项） |
| 归档任务的操作 | 底部操作表 | 系统对话框（`showActions`，点外部或返回键取消） |
| 群聊重命名 | `Alert.prompt` | 同样的单输入框对话框（`PromptDialog`） |
| 图片全屏查看 | 可缩放 ScrollView | 双指 1–4 倍缩放、放大后拖动、单击关闭（gesture-handler + Reanimated） |
| 返回 | 导航栏返回 | 导航栏返回箭头与系统返回键 |
| 等宽字体 | Menlo | monospace |
| 明文 http:// 地址 | NSAllowsArbitraryLoads | 传输模块清单开启 `usesCleartextTraffic` |

Android 只申请相机与网络权限（`app.json` 屏蔽模板带入的悬浮窗与旧存储权限）；相册和文件使用系统选择器。启动图标暂用通用图标（启动器自动套用系统形状），专用自适应图标需要由图标原稿另行提供。

## 运行（开发）

```bash
npm ci
npx expo prebuild --platform ios --clean   # 生成 ios/（CNG，勿手改）
npm start                                   # Metro；手机/模拟器装 dev build 后连接
npm run ios                                 # 或直接构建到模拟器
```

Android 需要 JDK 17 与 Android SDK（platform 37、build-tools 37.0.0、NDK 27.1.12297006、CMake 3.22.1，版本以 `node_modules/react-native/gradle/libs.versions.toml` 为准）。示例安装：`brew install openjdk@17`，从 developer.android.com 下载 command-line tools 到 `~/Library/Android/sdk/cmdline-tools/latest` 后用 `sdkmanager` 安装上述包。手机打开「开发者选项 → USB 调试」并在首次连接时允许这台 Mac。

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=$HOME/Library/Android/sdk
npm run prebuild:android                    # 生成 android/（CNG，勿手改，已被 .gitignore 忽略）
npm run android                             # 构建 debug 版并装到 adb 连接的设备（需 Metro）
```

native 模块在 `modules/baton-transport`：`ios/`（URLSession，Swift）与 `android/`（OkHttp，Kotlin）实现 `index.ts` 的同一契约——证书指纹固定的 HTTPS、证书探测、SSE、上传/下载与不可变缓存、`CODE: detail` 错误。改 Swift 后需重新 `xcodebuild` / `expo run:ios`；改 Kotlin 后重新 Gradle 构建。

## 测试

```bash
npm test            # 单元测试（登录地址解析、目录树、Android 驱动的界面树解析）
npm run typecheck   # tsc
node tests/e2e/run.mjs <steps.json> <out-dir>                    # iOS 模拟器/设备上已装 App 的 UI 驱动
node tests/e2e/run.mjs <steps.json> <out-dir> android[:serial]   # Android 设备/模拟器（adb + uiautomator）
node --test ../../tests/i18n.test.mjs           # 仓库根：手机文案必须有 en / zh-TW 条目
(cd android && ./gradlew :baton-transport:testDebugUnitTest)     # Kotlin 传输规则单测（SSE 分帧、指纹、文件名）
```

隔离验收工作空间（仓库根执行）：`node apps/mobile/tests/e2e/workspace.mjs [--port 9543] [--http]`。脚本在新建的临时目录里创建本机工作空间、管理员账号、自签名证书和示例数据（暂停中带图片附件的任务、待验收任务、已归档任务、带图片的私聊、群聊、自动化），打印地址、账号、密码和证书指纹；Ctrl-C 停止服务并删除整个目录。示例员工使用 Codex Runtime，而隔离 HOME 中没有它的 CLI 与凭据，发送消息会很快失败并进入重试界面，不会调用任何模型。Android 设备经 `adb reverse tcp:9543 tcp:9543` 访问 Mac 回环地址，登录地址填 `https://127.0.0.1:9543`。

E2E 驱动通过 bundle id / 包名驱动已安装的 App；步骤 JSON 支持 launch/activate/tab/tap/tapPoint/type/set/back/swipe/alert/shot/dump 等（`^` 前缀匹配、`~` 包含匹配）。示例：

```json
[{"action":"tab","value":"更多"},{"action":"tap","value":"^数字员工"},{"action":"shot","value":"agents"}]
```

预期：`<out-dir>/agents.png` 为数字员工列表；任一步找不到元素时退出码非 0，并保存 `failure-*.png` 与界面树（iOS `failure-tree.txt`，Android `failure-tree.xml`）。Android 按 content-desc（accessibilityLabel）、文本或 resource-id 匹配，`back` 发送系统返回键，`type`/`set` 经 `adb shell input text` 只能输入 ASCII，仅 Android 的 `hideKeyboard` 在键盘弹出时收起键盘（未弹出时不动作）。真机或模拟器验收：起隔离工作空间、生成配对链接、打开 App 走完整流程，浅色与深色各看一遍。

## 打包真机

```bash
./package-device.sh build/BatonMobile.ipa   # iPhone
./package-device.sh build/BatonMobile.apk   # Android：release APK（默认只含 arm64-v8a，ANDROID_ARCHS 可覆盖）
adb install -r build/BatonMobile.apk        # 安装到 adb 连接的手机，不需要 Metro
```

Android release 包使用 Expo 模板自带的调试签名，适合本机或测试设备直接安装；上架或分发需要换成自己的签名密钥，换签名后需先卸载旧包。

用 Xcode 组织 `Baton.xcworkspace`（scheme Baton）或直接_archive_ 出 IPA；开发签名 IPA 仅可装到描述文件授权的设备。首次安装如提示未受信任开发者，在 iPhone「设置 → 通用 → VPN 与设备管理」中信任。

## 结构

- `src/app/` Expo Router 路由；`(workspace)/` 为底部标签页（任务、沟通、自动化、更多），`task/`、`chat/`、`automation/`、`directory/`、`settings/` 为推入的详情页。
- `src/ui` Graphite 组件：图标按钮、原生菜单、分组卡片、搜索工具栏、图片查看器等（色板由 `scripts/build-tokens.mjs` 从 `web/tokens.css` 生成）。
- `src/lib/file-tree.ts` 把扁平路径列表展开为可折叠目录树（文件、变更、快照共用；`tests/file-tree.test.ts`）。
- `src/features` 各业务能力：`tasks`、`workspace`（协作、文件、控制台、详情）、`chats`、`messages`（消息与附件）、`automations`、`directory`（更多的只读数据与详情视图）、`settings.tsx`（Mac 设置的只读读取）。
- `src/api` 网关客户端（Bearer + 证书固定 + SSE）；工作空间关闭后，仍在卸载的页面请求会失败而不是崩溃。
- `modules/baton-transport` 原生传输（`ios/` Swift、`android/` Kotlin 及其 JVM 单测）。
- `tests/e2e` UI 驱动（`run.mjs` 入口，iOS 用 XCUITest，Android 用 `android.mjs`）与隔离验收工作空间 `workspace.mjs`。
- `src/i18n` 复用 `client/i18n.mjs` 与 `client/locales/*.json`（简中源文本）。

前台共用一个工作空间实时订阅。设置显示当前工作空间，退出登录后可连接其他地址。

登录页单行显示工作空间 URL，选择器和列表用相同的小圆点表示连通状态。每个已添加的地址都可单独移除。更多页显示当前账号，工作空间详情位于设置。
