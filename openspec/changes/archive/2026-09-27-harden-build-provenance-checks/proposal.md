## Why

第三方复核发现，当前 CI 会从最新 `core/main` 重建并通过，但没有证明已提交的 `dist` 与该构建一致；同时缓存工作区的未提交修改可能被编译进产物，却仍以原始 SHA 写入 provenance。两种情况都会破坏 Git 安装产物的可复现性与溯源准确性。

## What Changes

- 新增按已提交 `dist/core-provenance.json` 的 SHA 重建并与已提交 `dist` 做零差异校验的 CI 检查。
- 保留更新构建读取 `core/main` 的行为，但让复验脚本不读取最新远端分支。
- core 缓存命中后拒绝任何已跟踪或未跟踪的工作区修改，再允许复制源码。
- 增加针对提交产物校验和脏缓存拒绝的自动化验收，并更新构建脚本说明。

## Capabilities

### New Capabilities

- `build-provenance-validation`: 校验已提交 Pi 产物确实由其 provenance 指向的 core SHA 构建，并拒绝使用脏 core 缓存。

## Impact

- 影响 `scripts/build.ts`、`scripts/prepare-core.ts`、新增复验脚本、`package.json`、CI 和测试。
- 不改变 provider 注册、凭据解析、协议映射、模型能力推断或网络降级行为。
- 不修改 OpenCode 仓库；OpenSpec 与实现全部位于 Pi 仓库。
