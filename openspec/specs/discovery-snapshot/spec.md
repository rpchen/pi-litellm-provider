# discovery-snapshot Specification

## Purpose
Defines how Pi persists, restores, validates, and republishes endpoint-bound discovery snapshots while preserving Core compatibility rules and Pi-specific credential-less restore behavior.

## Requirements

### Requirement: snapshot persistence
A successful network discovery SHALL persist the Core discovery snapshot alongside Pi's host-facing model list.

#### Scenario: first success
- **WHEN** discovery succeeds for a configured endpoint
- **THEN** the host catalog persistence payload includes the neutral snapshot

#### Scenario: endpoint changes with same models
- **WHEN** a new endpoint yields the same host model list as the previous endpoint
- **THEN** Pi still persists the new endpoint-bound snapshot

### Requirement: drift observation
Pi SHALL compare the previous compatible snapshot with a newly successful snapshot.

#### Scenario: compatibility drift
- **WHEN** model membership, protocol, or capabilities change
- **THEN** Pi records a warning summarizing the drift counts

### Requirement: host-owned persistence
Pi SHALL NOT create a separate filesystem cache for PR6 snapshots.

#### Scenario: persistence transport
- **WHEN** Pi stores or restores the snapshot
- **THEN** it uses the existing provider `stored` / `publish` lifecycle surface

### Requirement: Pi current-policy snapshot restore
Pi SHALL 仅在Core接受schema2及关键完整性、endpoint/credential/结果相关scope一致时恢复中立模型；contextTierCap与price不决定scope或可用性。保持restore-only无网络，以及宿主省略credential时现有匿名URL/options scope和activation检查；有credential时必须匹配完整scope。 旧schema不恢复；价格错误由Core归零，关键损坏仍拒绝。

#### Scenario: [T19] 旧策略不回放
- **WHEN** 只有schema1快照
- **THEN** 等待成功刷新重建，不暴露旧空档位/cap

#### Scenario: [T21] scope不兼容
- **WHEN** credential、endpoint或协议选项改变
- **THEN** 不恢复旧模型

#### Scenario: [T19] 价格损坏
- **WHEN** 关键配置与指纹合法但cost损坏
- **THEN** 恢复能力并显示参考价0
