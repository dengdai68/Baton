# 紧凑设置与打开工作目录

目标：任务详情在复制后直接打开当前 Run 文件夹；Runtime 双字段、关闭选项、仓库 Token 与操作各自同排，正常配置仅留一条总提示，两种下拉间距一致。范围为现有 renderer、受限 Electron 宿主与对应验收；不改 Store、Runtime 调用、HTTP/CLI 配置协议或真实任务状态。

事实：本机 beta.102 任务列表可正常访问，正式 CLI 只读确认15个任务，6待验收、3取消、1阻塞、5完成，无运行中任务。原 Runtime 仍为单列表单，模型与原生思考下拉间距不同；仓库输入和操作分行、常规关闭选项竖排。当前修改保留其他会话未提交内容，不创建分支或混入提交。

实现：模型/思考等级使用同一行网格，展开隐藏重复摘要，正常字段说明隐藏，保留加载失败/不适配清除等真实错误；两类菜单均4px间距，模型输入到菜单增加4px悬停桥，六项可见。常规关闭选项两列；Token输入、保存与已有移除操作同行等高。目录打开为零参数IPC：宿主核对本窗口主frame当前Run页面，通过同Session认证workspace summary读取绝对目录，校验Run ID与真实目录后调用shell.openPath。renderer不能提供任意路径；失败toast且恢复按钮，不切页。

验证：同一工作树文件复制到本机临时目录执行 `npm test`，546通过、0失败（`/private/tmp/agentforge-beta103-tests-local.log`，47.6秒）。初次全量测试有1个旧宿主方法数断言失败（545/546），更新为新增受限方法后全量通过；未放宽宿主边界。check:ai/check:impact、规定server/app语法及settings/main/preload语法、git diff --check通过。

隔离安装包UI首次脚本在夹具准备时报错：createRun返回Run而非嵌套Task，改为读取completedRun.workspacePath后通过。`.data/runtime-settings-NS7IAj/evidence.json`（本机临时验证目录）覆盖两主题×1320/760窗口、双字段同行、两类下拉4px间距和跨间隙选第六项、折叠DOM/草稿保留、保存/正式CLI回读、停用门禁与共享登录回归；通过真实宿主和Finder打开隔离Run目录。截图目检发现输入框/按钮高度略不同，统一为36px后再次运行完整UI验收。仅夹具使用创建/归档/恢复/确认操作，不对真实实例任务发命令，不把夹具当作真实Provider执行证据。

CLI核对：本轮仅展示及桌面目录打开能力；现有配置输入输出、帮助、schema和任务协议未变，无CLI扩权或协议变更。未重复调用模型。

本机交付采用临时目录重打包：复用已安装beta.102的Electron与生产依赖，覆盖当前105个项目文件与版本为beta.103，逐文件比对一致，沿用entitlements并重新ad-hoc签名，codesign深度严格验证通过。本轮未生成标准ZIP/DMG或发布GitHub Release。已安装到 `/Applications/AgentForge.app` 并正常启动。

最终UI验收通过：本机临时验证目录 `.data/runtime-settings-t35pqN/evidence.json`，两主题及1320/760窗口全部通过，Token与保存等高，目录打开真实成功。包内105个项目文件与当前源码一致；安装asar SHA256为 `4e0a0e5e2db1942ecf27f5b39cd815aad61be33b2056dfd15526d059f9e52bcb`。

实机审阅：退出前客户端停留任务列表，无编辑表单；正常Cmd+Q后替换并启动beta.103，保留登录。打开用户指定任务run_mvwb6ulk_ih的详情，复制后可见打开；实际点击后Finder展示该Run及artifacts/docs/logs/tmp。其协作记录依次为开始协作→经理派工给成员→成员交接给经理→经理提交人类验收，未见JSON信封或自动验收文件面板。随后实际查看常规、展开Claude Code Runtime及仓库访问，截图确认同行布局，仅查看未保存配置。最后返回任务列表。更新前后正式CLI只读检查均为15任务，状态分布及ID摘要 `f7a59bb9168d9833f7cb872be90be6868ed58d168ba1aefa589c4dc30830f7d4` 一致；未修改真实任务或Token。
