## MODIFIED Requirements

### Requirement: 真实宿主 E2E
Real Pi latest E2E SHALL 真实安装 candidate 后验证：扩展加载成功；diagnostics 显示 Runtime Identity 且短值与 candidate 对应；audit 含完整值且模型无 baseUrl 泄露；startup 含同一 identity；不依赖 `.git`；隔离 HOME/XDG/`PI_CODING_AGENT_DIR`。

#### Scenario: [REAL-HOST-E2E] 真实宿主闭环
- **WHEN** 在隔离目录中用 `pi install` 安装不可变 commit/tag 并以本地 fake LiteLLM 验证
- **THEN** 上述 diagnostics / audit / startup / provenance 断言全部通过
