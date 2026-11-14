# 应用图标原图替换

目标与边界：替换为用户最新提供的铺满画布图标，保持原始PNG不重绘；侧栏、Dock、菜单栏和macOS包图标共用同一来源。仅图像资源和来源记录变化，主题、CLI/API与执行协议不变。

事实与实现：新原图为1254×1254、带透明通道，SHA-256为46bb3c5165723bba5f63f070de19647fa6c6385366579d0d9a9a9bb1277e937e；已原样复制至web/icons/application.png。现有scripts/build-app-icon.cjs使用sips/iconutil生成apps/electron/application.icns，解包后十个尺寸资源齐全并目检512px版本。现有宿主Dock/菜单栏和侧栏已引用同一PNG，无需新增代码或接口。同步来源README、现有来源完整性测试、设计文档、导航地图、模块注册表及CHANGELOG。

验证：本机临时源代码副本npm test为546通过、0失败（65秒）；check:ai/check:impact、规定server/app语法与git diff --check通过。隔离beta.106应用两主题×1320/760宽窄窗口品牌验收通过，证据.data/brand-presentation-4edMgn/evidence.json（位于本机临时验证目录），日志/private/tmp/agentforge-beta106-presentation.log，测试日志/private/tmp/agentforge-beta106-tests.log。未调用Provider或修改真实任务。

打包：beta.106本机候选复用已安装Electron/生产依赖，覆盖并逐文件比对105个项目文件；同时替换Info.plist所指向的Contents/Resources/icon.icns并核对与源码ICNS字节相同，避免仅替换ASAR内资源。ad-hoc签名及codesign深度严格校验通过。候选位置见/private/tmp/agentforge-beta106-preview-path；未发布Release。

安装状态：正式CLI只读确认视频翻译任务仍在running，本轮未退出、重启或替换当前beta.105客户端。新图标已在隔离候选验证，真实安装版新图标须待任务暂停或结束后更新核对。未提交或推送混合工作树。
