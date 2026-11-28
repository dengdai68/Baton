# Baton Relay 交互报告

测试时使用隔离账号 `relay-test`。桌面操作使用隔离的 Baton 服务、Chrome 及运行本次检出源码的 Electron 44.11.5。截图保存在本次运行目录的 `relay-evidence/`。配对链接和二维码已在邀请截图中遮盖。

| 操作 | 观察 | 证据 |
| --- | --- | --- |
| 在 Mac 保存 Relay 地址 | 保存地址后，页面显示「已连接」，「添加手机」可以点击。 | `mac-connected.png` |
| 从 Electron 桌面应用添加手机 | 在隔离实例输入测试账号和密码，进入「设置 → 工作空间」，打开远程访问、保存 Relay 地址并等到「已连接」。点击「添加手机」显示真实二维码和地址，也能展开原有「局域网与 SSH 转发」。 | `electron-invitation.png` |
| 从工作空间设置进入远程访问 | 在 390 像素宽的 Chrome 窗口点击「远程访问 · 添加手机」，验证签发账号、展开指纹以及生成邀请后的页面均在视口内完整显示。 | `mac-narrow.png` |
| 点「添加手机」 | 页面出现二维码、一次性配对地址和十分钟有效期提示。将页面实际生成的二维码交给 Apple Vision 解码，读出的文本与页面的配对地址逐字相同。 | `mac-invitation.png`、`qr-decoding.txt` |
| 兑换并移除一台设备 | 使用协议测试设备兑换 Mac 页面生成的邀请，服务返回签发账号的令牌。页面显示设备名称和创建时间。点击「移除」，页面回到「尚无配对手机」。 | `mac-paired.png` |
| 从 Baton App 手动配对 | iPhone 17e 模拟器上的完整 Baton App 显示原有账号登录、扫码和输入地址三个入口。打开扫码页可看到相机授权入口。返回登录页并输入 Mac 生成的完整邀请后，App 自动进入任务页；结束进程后再打开仍回到任务页。 | `ios-login.png`、`ios-scan.png`、`ios-pair-form.png`、`ios-workspace.png`、`ios-relaunch.png` |
| 将二维码中的新邀请交给 iOS | 先从 App 设置退出，Mac 签发新邀请。Apple Vision 确认二维码文本，随后通过系统打开该地址。点 iOS 的「打开」后，Baton 自动进入任务页。Mac 设备列表中有一台手机，点击移除后授权数为零。此用例涵盖二维码解码和系统打开地址，使用的是模拟器。 | `ios-qr-link.png`、`mac-product-paired.png`、`ios-product.txt` |
| 在 iOS 原生传输层配对 | iPhone 17e 模拟器上的原生测试应用显示已以测试账号配对，认证 API 返回 200。测试使用 Mac 签发的配对地址。 | `ios-native-probe.png` |
| 处理无效邀请 | 原生测试应用分别提交错误 Mac 指纹、错误凭据和已消费的邀请。三次均未获得通道。 | `ios-native-cases.json` |

业务侧每次配对授予「当前账号＋这台手机」独立通道。手机切换到其他网络或 Relay 重启时沿用原通道。撤销设备后，Mac 在 7 天内继续登记该通道，手机经内层连接收到 401 并显示「此设备已被移除」；只有 Mac 未连接 Relay 时才表现为连接失败。

真机通过摄像头扫描实体二维码、蜂窝网络漫游、Android App 端到端交互和已安装的 Electron 发布包仍待实测。
