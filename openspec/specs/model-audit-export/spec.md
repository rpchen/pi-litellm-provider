# model-audit-export Specification

## Purpose
定义 Pi 扩展的 `/litellm-audit-export`：把当前已注册 provider 模型清单按 allowlist 导出到本地 JSON 文件并附带完整 Runtime Identity，不泄露凭据、地址与原始响应，与 OpenCode 插件的审计语义对齐。

## Requirements

### Requirement: Pi audit export 命令
扩展 SHALL 提供用户明确调用的 `/litellm-audit-export [endpoint-id]`，将当前已注册 provider 模型清单导出到本地 JSON 文件并经 `ctx.ui.notify` 报告绝对路径。无参数时导出全部 active endpoint；带 endpoint id 时未知 id 报 warning。导出失败 MUST NOT 影响 provider 注册与轮询。

#### Scenario: [AUDIT-FULL] 完整 identity 与模型清单
- **WHEN** 用户执行 `/litellm-audit-export`
- **THEN** 报告包含 `runtimeIdentity { pluginVersion, artifactDigest: "sha256:<完整>", coreCommit: "<完整40位>" }`，且与 diagnostics 短值对应、与构建产物一致；`endpoints[]` 列出各 endpoint 的 providerId、状态、模型数与 allowlist 模型

#### Scenario: [AUDIT-SAFE] 最小化数据
- **WHEN** 模型、凭据或上游响应中含有测试 Key、私有地址、路由或其他敏感标记
- **THEN** 报告不包含 `baseUrl`、凭据、原始响应与可扩展设置，同时保留模型 id、推理等级等允许字段的真实注册值

### Requirement: 正式交付严格验证
正式 distribution / release verification SHALL 要求三字段全部存在并有效，否则失败且不做 silent fallback：`pluginVersion` 为空或与 `package.json` 不一致则失败；digest 非 `sha256:<64hex>` 或与重算不一致则失败；Core SHA 非完整 40 位 hex 或与 provenance 不一致则失败；provenance 缺失/损坏则失败。

#### Scenario: [VERIFY-STRICT] 缺失与非法被拒绝
- **WHEN** identity 缺失、字段为空、digest 非法、Core SHA 非法或 provenance 损坏
- **THEN** `verify:dist` 失败

### Requirement: 可重复构建
同一 source + 同一 Core SHA + 同一 package version 的两次构建 SHALL 得到相同的 `artifactDigest`。时间戳、临时目录、Windows 路径、HOME、cache 路径 MUST NOT 改变 digest。

#### Scenario: [REPRODUCIBLE-BUILD] clean rebuild 一致
- **WHEN** 在不同临时目录执行两次固定 SHA 构建
- **THEN** 两次的 `artifactDigest` 完全一致

### Requirement: Package 与 tarball 行为
打包产物 SHALL 包含 `dist/runtime-identity.json` 与 `extensions` 入口；安装后仍可读取；MUST NOT 依赖 `.git`、源码目录、build workspace；Core provenance 与 identity 的 `coreCommit` SHALL 一致。

#### Scenario: [PACKAGE-IDENTITY] tarball 可验证
- **WHEN** 对真实 tarball 执行 package test 并隔离安装
- **THEN** identity 可读、三字段有效、coreCommit 与 provenance 一致

### Requirement: 真实宿主 E2E
Real Pi 0.87.1 E2E SHALL 真实安装 candidate 后验证：扩展加载成功；diagnostics 显示 Runtime Identity 且短值与 candidate 对应；audit 含完整值且模型无 baseUrl 泄露；startup 含同一 identity；不依赖 `.git`；隔离 HOME/XDG/`PI_CODING_AGENT_DIR`。

#### Scenario: [REAL-HOST-E2E] 真实宿主闭环
- **WHEN** 在隔离目录中用 `pi install` 安装不可变 commit/tag 并以本地 fake LiteLLM 验证
- **THEN** 上述 diagnostics / audit / startup / provenance 断言全部通过

### Requirement: Out of scope
本 change MUST NOT 引入 `Plugin Commit`、`builtAt`、运行时 `.git` 读取、cache 路径解析、分支推断、latest release 推断、全错误消息注入、telemetry。

#### Scenario: [OUT-OF-SCOPE] 无时间戳与 Git 依赖
- **WHEN** 检查构建产物与运行时行为
- **THEN** 产物中无 `builtAt`，运行时无 Git 子进程与 `.git` 读取
