# BatonTransport

`index.ts` 定义给 TypeScript 调用的接口，`expo-module.config.json` 登记两端模块。`ios/` 保存 Swift 源码和 podspec，`android/` 保存 Kotlin 源码、模块 Gradle 配置、清单及 JVM 测试。模块负责证书探测与校验、HTTP 请求、SSE 以及附件传输。修改原生实现后按 [手机端构建说明](../../README.md) 重新构建目标平台。

Swift、Kotlin、清单、podspec 和 Gradle 配置都属于应纳入 Git 的源码。模块的 `android/build/`、`android/.cxx/` 和 `android/.gradle/` 由本机工具生成。
