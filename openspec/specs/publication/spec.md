# publication Specification

## Purpose

Pi 消费 Core 的 configured/configured-lkg 结果，准确注册能力、限制与明确推理档位；其他模型保留具体诊断。价格不决定发布、能力或缓存恢复。

## Requirements

### Requirement: Publication partition governs registration
The extension SHALL register only models Core reports as `configured` or `configured-lkg`, and SHALL keep every other discovered model out of Pi registration with its status and complete reason list visible in diagnostics. No user confirmation, acceptance, or override exists or may be added: a withheld model cannot be moved into the published set by any Pi action.

#### Scenario: Complete models register normally
- **WHEN** discovery returns Core-configured models
- **THEN** they register with correct limits, input, cost, and protocol mapping

#### Scenario: Incomplete models never disguise as normal
- **WHEN** a discovered model is missing limits or has unknown key capabilities
- **THEN** it does not register and diagnostics names its status plus missing/unknown/illegal fields

#### Scenario: Operational guard stays as second layer
- **WHEN** any spec with non-positive context or output reaches the host mapper
- **THEN** it is excluded from registration regardless of publication state

#### Scenario: Repeated refreshes never force a withheld model in
- **WHEN** a withheld model is refreshed repeatedly and no user action is taken
- **THEN** every refresh returns the same withheld result; there is no command, flag, or stored state that changes it

#### Scenario: DeepSeek official provider limits reach the Pi host config
- **WHEN** the endpoint serves `deepseek-v4.1-flash` (descriptive `model_info` output cap 384000/393216-class values) and the Core publication resolves the canonical identity `deepseek/deepseek-v4.1-flash` to the official `deepseek` provider record (`selectionSource: canonical-original`, `limit.output = 393216`)
- **THEN** the registered Pi model maps `spec.limit.context` to `contextWindow` and `spec.limit.output` to `maxTokens` with `maxTokens = 393216`, never the OpenRouter reseller serving limit `943718`

#### Scenario: Reseller fallback conflicts stay withheld
- **WHEN** no official provider record is provable and the fallback-selected OpenRouter record's serving limit conflicts with the endpoint's own declarations
- **THEN** the model is withheld, `maxTokens = 943718` never reaches Pi registration, and diagnostics report the unresolved conflict with the fallback serving evidence origin

#### Scenario: Fallback never rewrites the canonical identity
- **WHEN** discovery selects an OpenCode or OpenRouter fallback record for a model whose deployment identity is `deepseek-v4.1-flash`
- **THEN** the registered model id and candidate names remain the deployment's own identity (never `opencode/...` or `openrouter/...`)

### Requirement: Reasoning follows the Core verdict
The extension SHALL set the Pi `reasoning` flag from the Core
`reasoningSupported` verdict, and SHALL report support-without-levels as
reasoning-capable with no level map.

#### Scenario: Toggle-style reasoning without levels
- **WHEN** a model is reasoning-supported with no selectable levels
- **THEN** it registers with `reasoning: true` and no `thinkingLevelMap`

#### Scenario: Confirmed non-reasoning model
- **WHEN** Core reports reasoning unsupported
- **THEN** the model registers with `reasoning: false` and no level map

#### Scenario: Unknown reasoning blocks normal registration
- **WHEN** Core reports reasoning unknown and no valid LKG snapshot exists
- **THEN** the model does not register normally

### Requirement: Failures and LKG are visible and safe
The extension SHALL classify metadata failures with the Core taxonomy,
SHALL substitute only valid LKG snapshots (identity/schema/conflict
checked by Core, never TTL-expired), and SHALL show live-vs-LKG
selection, the LKG provenance and age, failure kind, and retry state in
diagnostics. A descriptive LiteLLM metadata difference reported by Core
as a resolved discrepancy SHALL NOT be presented as a failure and SHALL
NOT discard a trusted snapshot.

#### Scenario: Live failure with valid LKG
- **WHEN** the metadata source fails but a provably belonging complete snapshot exists
- **THEN** the model still registers with LKG provenance and diagnostics marks the LKG selection with age and reason

#### Scenario: Live failure without valid LKG
- **WHEN** no valid snapshot exists
- **THEN** the model stays withheld with the failure kind and reason visible, and no default-filled model registers

#### Scenario: Retry recovery
- **WHEN** a retry fetch returns complete trustworthy metadata
- **THEN** the model returns to normally configured state

#### Scenario: Descriptive discrepancy keeps the trusted snapshot
- **WHEN** Core reports a resolved discrepancy for a model that is otherwise served from LKG
- **THEN** the model stays registered from the trusted snapshot and diagnostics shows both the discrepancy and the LKG provenance

### Requirement: LKG 以 schema 8 同 resolution 派生

扩展 SHALL 在 seeding 时把 live catalog 与 build options 透传给 Core，使 LKG
条目由通过 gate 的同一 resolution 派生（`PUBLICATION_SCHEMA_VERSION = 8` 的
group-wide proof composition）；seeding 保持 best-effort（try/catch，永不失败
discovery）。内存中已存在的 v7 及更早条目 SHALL 被 Core 判不兼容（fail
closed），下一轮 live 自动重捕获为 v8。Pi 不复制 proof 判定、不持久化 LKG 条目。

#### Scenario: seeding 产出 v8 条目

- **WHEN** 某模型本轮 `configured` 且 Core 为 schema 8
- **THEN** store 中的条目 `schemaVersion` 为 8 且 `validateLastKnownGood` 对未变更的 live 输入通过

#### Scenario: 旧条目 fail closed 后重捕获

- **WHEN** store 中存在 v7 条目且 catalog 中断
- **THEN** 本轮不恢复该条目；catalog 恢复后的首轮 live 自动捕获 v8 条目
