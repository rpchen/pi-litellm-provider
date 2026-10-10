# provider-diagnostics Specification

## Purpose
Defines Pi user-facing LiteLLM diagnostics, including discovery status, cache source and freshness, models.dev and protocol summaries, safe failure reporting, and the zero-model-turn command path.

## Requirements

### Requirement: user-invokable diagnostics
The extension SHALL register /litellm-diagnostics and SHALL render the current LiteLLM diagnostic state using Pi's native command UI without sending a model turn.

#### Scenario: run diagnostics after successful discovery
- **WHEN** the user runs /litellm-diagnostics after discovery succeeds
- **THEN** the UI reports healthy status, model count, Core provenance, cache source, models.dev match statistics and protocol fallback count

### Requirement: cache source visibility
The adapter SHALL distinguish persisted snapshot restore, network discovery, short in-memory cache reuse and stale last-known-good fallback.

#### Scenario: startup restore
- **WHEN** endpoint-compatible models are restored before network access
- **THEN** diagnostics report snapshot source and restored/stale state

### Requirement: safe failure reporting
The adapter SHALL classify unconfigured, authentication, configuration and degradable discovery failures without putting credentials, endpoint URLs or raw error bodies in the user-facing diagnostic payload.

#### Scenario: authentication failure
- **WHEN** LiteLLM rejects the credential
- **THEN** diagnostics report an authentication category and zero registered models without echoing the credential

### Requirement: shared diagnostic semantics
The adapter SHALL consume Core diagnostics from the same model build used for registration.

#### Scenario: models.dev fallback
- **WHEN** models.dev enrichment is degraded
- **THEN** the Pi diagnostic output reflects Core's degraded/match statistics while registration continues with the normal LiteLLM-only fallback

### Requirement: 诊断展示 canonical 与 serving 事实

`/litellm-diagnostics` 的模型详情 SHALL 在 Core 提供时展示：canonical identity
与证据（`qualified-deployment` / `registry-unique` / `serving-relation`）、wire-ID
parse metadata（明确标注非证据）、serving 状态与 provider/record、推理档位状态
（`unknown` 显示恢复提示：声明 `models_dev_provider`；`known` 显示档位）、
operator-configuration 键（明确不是 enforcement）、诊断候选
（`provider/record → models_dev_provider` 声明提示）、catalog 形状。Core 未提供
这些字段时（旧 Core）SHALL 省略对应行，不崩溃、不编造。

#### Scenario: serving 未证明的档位 unknown 附恢复提示

- **WHEN** 某模型 canonical 已证明、serving 未证明、档位 unknown
- **THEN** 详情显示档位 unknown 及“声明 `models_dev_provider` 可恢复档位”的提示

#### Scenario: unresolved serving 给出可操作修复

- **WHEN** 某模型为 `serving-record-unresolved` 或 `declared-unmatched`
- **THEN** 详情以 warning 行提示使用精确 wire id 或更改 provider 声明，并列出可精确命中的 SKU 候选
