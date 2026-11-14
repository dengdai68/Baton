# 任务搜索与列表对齐

目标：缩小任务搜索区到列表的间距，使任务名称输入框左缘、新建任务按钮右缘与下方列表外缘对齐。范围仅桌面布局；搜索、分页、归档与CLI/HTTP/Store协议保持不变，无需真实模型调用。

事实：本机beta.103任务列表实机截图显示列表额外左右内缩；源码为共享full-panel的8px内边距，搜索表单底部14px与filter-bar底部12px叠加为26px。compact.css仅对任务列表移除重复横向内边距，表单不再加底部padding，filter-bar与列表仅8px分隔；保留窄屏自然换行和列表内部滚动。

验证：同一工作树文件复制到本机临时目录执行npm test，546通过、0失败（64秒，/private/tmp/baton-beta104-tests-local.log）；check:ai/check:impact、规定server/app语法、验收脚本语法和git diff --check通过。扩展现有test-runtime-settings，实际测量两主题×1320/760窗口的当前列表、空搜索、归档列表：左右边缘差小于1px，垂直间距8px，无页面横向溢出；搜索/重置及归档/恢复往返通过。证据位于本机临时验证目录.data/runtime-settings-UhX9sx/evidence.json，已目检宽窄截图。仅展示夹具，不作为Provider执行证据。

交付为本机beta.104签名应用：复用已有Electron/生产依赖，重打包当前105个项目文件并逐文件核对一致，沿用entitlements、ad-hoc签名及codesign深度严格校验；本轮未生成标准ZIP/DMG或发布Release。更新前客户端在任务列表、无编辑表单；正式CLI只读确认15任务、无正在执行任务。已正常安装并启动；本机真实任务列表截图确认左边缘对齐，右边缘含列表滚动条占位与新建任务区一致，搜索区与表头间距收紧。登录保留，更新前后15任务的状态分布和ID摘要均一致（6待验收、3取消、1阻塞、5完成），未修改真实任务。
