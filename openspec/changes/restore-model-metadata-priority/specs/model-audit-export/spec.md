# Spec Delta

## ADDED Requirements

### Requirement: Metadata provenance audit
Pi SHALL 在现有主动导出中以allowlist增加Core canonical ID、实际选中公开record key/provider、字段来源、选项未知/明确为空与快照来源。MUST NOT 复制raw LiteLLM/models.dev、route、URL、credential或任意扩展字段；报告保留实际注册值和原模型名，不自动导出。

#### Scenario: [T23] 安全可追溯
- **WHEN** 用户主动导出且原始输入藏有测试secret/URL/route
- **THEN** 报告有公开元数据来源与真实注册档位，未从非允许字段复制敏感值
