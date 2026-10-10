# Spec Delta

## REMOVED Requirements

### Requirement: core 逻辑单副本
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Pi single Core implementation；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

## ADDED Requirements

### Requirement: Pi single Core implementation
Pi SHALL 仅通过固定SHA构建的Core公共入口消费宿主无关语义，不保留本地业务实现。固定fixtures SHALL 以经评审的新Core契约为预期，不能要求永久保留旧proof/cap错误；构建/安装隔离契约不变。

#### Scenario: [T34] 新行为与固定SHA
- **WHEN** 构建获准合入的Core SHA
- **THEN** 所有测试/编译来自同一SHA，实际16映射遵守新预期
