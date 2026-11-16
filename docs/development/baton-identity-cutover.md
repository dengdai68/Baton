# Baton 当前身份与本机切换

当前产品名为Baton，GitHub来源为https://github.com/dengdai68/Baton。应用包Baton.app、Bundle ID com.baton.desktop、CLI命令baton、环境变量BATON_*、宿主桥window.baton及认证cookie baton_session统一使用当前身份。旧输入不提供别名。

私有配置根为~/.baton，开发实例为desktop-dev；默认工作根为~/.baton/workspace，当前业务库为<工作根>/records/baton.sqlite。配置JSON、认证数据库、Runtime及扩展继续遵循docs/30的归属；名称变化不增加服务、依赖或状态层。

本轮本机安装是一次显式切换：确认任务/沟通/插件更新空闲并关闭旧宿主，将现有私有配置复制到新控制目录；保留原工作根，在服务关闭后切换业务数据库文件名，追加已有runtime根的位置引用，安装Baton并核验同一历史。保留旧文件以便人工回退，不在源码增加自动迁移、备份或双版本兼容逻辑。若目标已有资料或存在未完成配置发布，停止切换，禁止覆盖或初始化空实例。

现有Task/Run的工作路径、不可变事件、冻结Runtime/工作流和历史文件引用保持事实原样；不能对真实数据库或外部工程做全局字符串替换。使用既有账号重新登录新应用；CLI由新宿主发布当前实例授权。旧受管agentforge命令仅在确认安装标记后移除，新宿主安装baton；不改非受管命令或系统PATH。

图标原图为用户提供的1254px PNG，逐字节保留；生成器只去掉演示图外留白、派生UI/Dock/ICNS，并从原B标志提取菜单栏模板。测试覆盖两主题/宽窄显示、原图SHA、透明边界和原生模板。
