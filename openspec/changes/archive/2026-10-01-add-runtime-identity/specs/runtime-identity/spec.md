## ADDED Requirements

### Requirement: Runtime Identity 定义
扩展 SHALL 提供当前运行 artifact 自身的不可变身份 Runtime Identity，只包含三个核心字段：`pluginVersion`、`artifactDigest`、`coreCommit`。它 MUST NOT 表示 Git HEAD、main、最新 Release、`.git` 推断状态或 cache 路径推断结果。第一版 MUST NOT 包含 `Plugin Commit` 与 `builtAt`。

#### Scenario: [IDENTITY-FIELDS] 三字段完整
- **WHEN** 读取已构建 artifact 的 Runtime Identity
- **THEN** `pluginVersion` 为插件 canonical package metadata 的版本，`artifactDigest` 为 `sha256:<64位hex>` 的确定性 artifact 摘要，`coreCommit` 为完整 40 位 Git SHA

#### Scenario: [IDENTITY-NO-GIT] 无运行时 Git 与 cache 推断
- **WHEN** 扩展在无 `.git`、无源码 checkout、隔离安装目录中运行
- **THEN** Runtime Identity 仍可读取，不执行 Git，不读取 `.git`，不从安装路径或分支名推断版本

### Requirement: Artifact digest 计算语义（与 OpenCode 一致）
`artifactDigest` SHALL 为固定 SHA-256，canonical 输入为 `dist/` 下全部常规文件（递归、POSIX 相对路径排序、原始字节），manifest 为逐行 `<file-sha256>  <relative-path>\n` 的 UTF-8 拼接后再 SHA-256。计算 MUST 排除 `runtime-identity.json` 自身，MUST 包含 `core-provenance.json`。结果 MUST NOT 依赖构建时间、本机路径、用户名、checkout 目录、Git 状态。相同输入 MUST 产生相同结果。`extensions/index.ts` 薄转发入口不纳入 digest，由 package test 断言其存在。

#### Scenario: [DIGEST-DETERMINISTIC] 输入顺序与路径归一
- **WHEN** 以不同文件枚举顺序或 Windows/POSIX 路径分隔计算 digest
- **THEN** 结果相同

#### Scenario: [SELF-EXCLUSION] 自排除无递归
- **WHEN** `runtime-identity.json` 自身内容变化而不改变其他 dist 文件
- **THEN** 按 canonical 输入重算的 digest 不变

#### Scenario: [DIGEST-SENSITIVE] artifact 变化敏感
- **WHEN** 任一被纳入输入的 dist 文件字节变化
- **THEN** digest 变化

### Requirement: Canonical 来源
扩展内部 SHALL 有且只有一个 canonical Runtime Identity 对象。diagnostics、audit export、startup log MUST 读取同一对象，MUST NOT 三处分别拼装。

#### Scenario: [CANONICAL-SINGLE] 三处同源
- **WHEN** diagnostics、audit export、startup log 输出 identity
- **THEN** 三者的 `pluginVersion`、`artifactDigest`、`coreCommit` 完全一致且来自同一读取入口

### Requirement: Diagnostics 短形式
`/litellm-diagnostics` SHALL 增加人类可读的 Runtime Identity 块：`Plugin Version <ver>`、`Artifact <digest前8>`、`Core Commit <sha前8>`。完整值 MUST NOT 挤满 UI。现有状态、缓存、models.dev、协议语义 MUST 不被破坏，不泄露凭据、URL、原始错误。

#### Scenario: [DIAG-SHORT] 短形式显示
- **WHEN** 用户执行 `/litellm-diagnostics [endpoint-id]`
- **THEN** 输出包含 Runtime Identity 三行短形式，且短值与完整值的对应前缀一致

### Requirement: Startup log 同源
扩展启动 SHALL 记录同一份 Runtime Identity，不泄露 credential，不打印本机敏感路径，不为取得 identity 访问网络或执行 Git。

#### Scenario: [STARTUP-LOG] 启动记录同一 identity
- **WHEN** 扩展完成初始 provider 同步或 `session_start`
- **THEN** 日志包含与 diagnostics / audit 相同的 `pluginVersion`、`artifactDigest` 短值、`coreCommit` 短值
