# CI 与发布

- `quality.yml` 在推送和 PR 时安装依赖、运行测试并检查模块影响。
- `release-macos-beta.yml` 构建并发布 Beta 产物，包含草稿附件模式。
- `release-macos-stable.yml` 校验正式标签，构建和校验签名及公证产物。
- `recover-release-upload.yml` 用于发布附件上传恢复。

发布条件及触发参数以对应工作流和[发布说明](../../.codex/skills/baton-release/SKILL.md)为准。
