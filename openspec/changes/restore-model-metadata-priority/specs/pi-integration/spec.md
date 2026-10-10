# Spec Delta

## REMOVED Requirements

### Requirement: 模型配置满足 pi 的字段要求
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Pi explicit model capability mapping；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

## ADDED Requirements

### Requirement: Pi explicit model capability mapping
Pi SHALL 提供宿主要求的id/name/api/input/cost/contextWindow/maxTokens并以Core明确reasoning verdict设置reasoning。支持无档位不得设false或省略map导致默认档位；unsupported为false；关键未知不得注册。

#### Scenario: [T29] 支持无档位
- **WHEN** 真实Pi接收supported与空variants
- **THEN** true且显式隐藏所有额外effort档位

#### Scenario: [T14] 不支持推理
- **WHEN** Core明确unsupported
- **THEN** false且不带推理请求设置
