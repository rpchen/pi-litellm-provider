## Why

用户和维护者无法可信地回答“当前正在运行的是哪一个 Pi 扩展 artifact”。现有 `provider-diagnostics` 只显示 `package.json` 版本与 Core provenance，不能区分同一版本的不同构建产物；Pi 至今没有 `/litellm-audit-export`，问题排查时只能猜测 Git HEAD、分支或 Release，无法对应到实际运行的 `dist/` 字节。本变更与 OpenCode 插件达到相同的产品语义和测试标准：统一、可信、确定性的 Runtime Identity。

Runtime Identity 由 `pluginVersion`、`artifactDigest`、`coreCommit` 三个字段组成，diagnostics、audit export、startup log 读取同一份 canonical 对象。

## What Changes

- 新增 canonical Runtime Identity 数据模型与唯一读取入口（diagnostics、audit export、startup log 同源）。
- 构建时生成 `dist/runtime-identity.json`：`pluginVersion` 取自 `package.json`，`coreCommit` 复用现有 `dist/core-provenance.json` 的 40 位 SHA，`artifactDigest` 为 `dist/` 确定性 SHA-256（排除 identity 文件自身，避免自引用）。
- 新增 `/litellm-audit-export`（此前明确 scope-out，本次为承载 Runtime Identity 而补齐，与 OpenCode 语义对齐）：导出完整 `runtimeIdentity` 与已注册模型 allowlist，不泄露凭据/URL/原始错误。
- `/litellm-diagnostics` 增加人类可读的 Runtime Identity 短形式（digest 与 Core SHA 各前 8 位）。
- 扩展启动（`session_start` 与初始注册路径）记录同一份 Runtime Identity（不泄露凭据/路径，不访问网络，不执行 Git）。
- 正式 distribution / release verification 要求三字段全部存在且格式合法，否则失败，不做 silent fallback。
- clean rebuild digest 一致；artifact 文件变化导致 digest 变化；被排除的 identity 文件自身变化不递归。
- 不引入 `builtAt`、`Plugin Commit`、运行时 Git、`.git` 依赖、cache 路径推断、telemetry。
- README 增加面向用户的 Runtime Identity 说明。

## Capabilities

### New Capabilities
- `runtime-identity`: Runtime Identity 定义、digest 计算语义、自引用避免、diagnostics / audit / startup 行为、正式验证失败语义、可重复构建、package 与真实宿主 E2E。
- `model-audit-export`: Pi 的 `/litellm-audit-export`（模型 allowlist、文件写入、与 Runtime Identity 同源）。

### Modified Capabilities
<!-- 现有 diagnostics / shared-core-build 行为通过新 capability 叠加，不改写其已有语义 -->

## Impact

- 使用的 Pi 扩展 API：`registerCommand`（新增 `litellm-audit-export`，沿用 `litellm-diagnostics` 模式）、`registerProvider` / `unregisterProvider`（不变）、`ui.notify`（diagnostics 与 audit 结果展示）、`on(session_start/session_shutdown)`（启动日志）。依赖 Pi 版本区间不变（真实 E2E 固定 0.87.1）。
- 与共享 core 的边界：**不修改 core 业务逻辑**；`coreCommit` 只读取现有 `dist/core-provenance.json`，digest 输入包含已编入的 core 产物但不复制 core 算法。
- 构建交付：`scripts/build.ts` 增加 identity 生成与 digest 计算；`scripts/verify-dist.ts`、`scripts/test-package.ts` 增加 identity ↔ bytes ↔ provenance 一致性验证。不削弱现有 committed dist、clean rebuild 门禁。
- 新增运行时依赖：无。
