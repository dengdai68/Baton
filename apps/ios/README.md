# Baton for iPhone

在 Xcode 打开 `BatonMobile.xcodeproj`，选择 BatonMobile scheme 和已解锁并信任此 Mac 的 iPhone，使用设备所属的开发团队签名后运行。App 使用 SwiftUI、VisionKit 和隔离的 WKWebView。

Xcode 生成已签名的真机 Release 构建后，可运行 `apps/ios/package-device.sh /path/to/Release-iphoneos/BatonMobile.app apps/ios/build/BatonMobile.ipa`。打包后会解压并核对签名。首次安装开发版如提示证书未受信任，请在 iPhone「设置 → 通用 → VPN 与设备管理」中选择对应的开发者并完成信任。

**连接本机**　在 Mac 的 Baton 菜单选择「连接 iPhone…」。同一 Wi-Fi 下使用建议的 HTTPS 地址并允许局域网访问。生成配对码后在 iPhone 的 Baton 扫描，也可粘贴链接。设备绑定该服务的证书，配对码五分钟内有效且只可用一次。Mac 可以单独撤销任一设备。通过公网访问时先按 BatonRelay 的 README 启动 SSH 转发，把手机访问地址填为应用的公网 HTTPS 地址并勾选 Relay。

**连接云端**　在 iPhone 输入工作空间 HTTPS 地址，使用管理员创建的个人账号登录。在 Mac 选择 Baton 菜单「云端工作空间…」输入同一地址也能访问。手机和桌面同步使用服务器上的任务、沟通和待办。

## 独立运行服务

在 Baton 项目根目录执行以下示例。每个实例选择独立私有目录，命令使用 Node 22.12 或更新版本。云端示例使用公网地址及本机监听端口，需配置 DNS、防火墙并把配置里的 cert 和 key 指向该域名的受信任证书链和私钥。

    npm ci
    npm run workspace -- init /srv/baton/cloud cloud https://baton.example:9443 9443 0.0.0.0
    npm run workspace -- member /srv/baton/cloud alice < /private/alice-password
    npm run workspace -- operator /srv/baton/cloud operator < /private/operator-password
    npm run workspace -- serve /srv/baton/cloud

成员可重复添加。operator 管理运行环境和共享员工目录，通过该实例所在主机上的 Baton CLI 登录。使用隔离的会话文件，每条管理命令都带相同的两个路径。

    baton --endpoint-file /srv/baton/cloud/desktop-endpoint.json --session-file /srv/baton/cloud/cli-session.json auth login --username operator
    baton --endpoint-file /srv/baton/cloud/desktop-endpoint.json --session-file /srv/baton/cloud/cli-session.json agents list

本地独立进程同样使用 init、serve。模式填 local，Relay 场景绑定 127.0.0.1，origin 填该应用的公网 HTTPS 地址。另开终端执行 `npm run workspace -- pair DIR` 生成配对码，`devices DIR` 查看设备，`revoke DIR DEVICE_ID` 撤销授权。桌面内置服务通过菜单启用即可。Mac 需保持运行和联网。

## 测试

如果首次连接时 iOS 要求允许本地网络访问，完成授权后可在连接错误页点「重新连接」。真机验收会通过配对链接打开 App，在隔离工作空间创建任务。

XCTest 的 WorkspaceTests 连接真实测试服务。测试计划提供 BATON_TEST_ADDRESS（一次性配对链接或云端 HTTPS URL），云端另提供 Kai 测试账号的 BATON_TEST_PASSWORD；测试实例需有可参与任务的员工。开发签名 IPA 仅可安装到描述文件授权的设备。

云端可额外设置 BATON_TEST_ACCEPT_TITLE 指向另一位成员已授权且等待验收的任务。测试会在「待我处理」完成验收，再创建任务，从而覆盖实际用户操作及二次确认。
