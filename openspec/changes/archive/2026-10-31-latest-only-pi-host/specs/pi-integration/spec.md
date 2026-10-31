## MODIFIED Requirements

### Requirement: 真实 Pi 宿主契约必须有永久 E2E 门禁
涉及 Pi 宿主契约的候选变更 SHALL 在 CI 中使用从 npm latest 解析的精确版本的真实 `@earendil-works/pi-coding-agent` 验证，而不是只依赖模拟 `ExtensionAPI`、直接调用 extension factory 或 package 文件存在性检查。E2E MUST 使用 Pi 自己的 `pi install` 安装固定 Git commit，MUST 隔离 `HOME`、XDG 与 `PI_CODING_AGENT_DIR`，MUST 使用本地 fake LiteLLM 与脱敏测试凭据，并 MUST 经过真实 extension loader、ModelRuntime、credential store、command registry 与 `refreshModels`。

#### Scenario: 固定 Git 候选由真实 Pi 加载
- **WHEN** CI 用 Pi 自己的 package installer 安装当前不可变 Git commit 并启动 RPC 宿主
- **THEN** `litellm-endpoints` 与 `litellm-diagnostics` 作为 package extension command 出现在真实宿主 command registry，且扩展无加载错误

#### Scenario: 多 endpoint 在真实宿主中保持凭据与模型隔离
- **WHEN** 两个本地 fake LiteLLM endpoint 分别配置独立的宿主 credential 后执行真实 endpoint refresh
- **THEN** `litellm` 与 `litellm-company` 分别出现各自模型，每个 fake endpoint 只收到自己的 Bearer credential，且不会跨 endpoint 泄漏

#### Scenario: 非 operational 模型不会进入真实宿主
- **WHEN** fake LiteLLM 同时返回正常模型和 context/output 非正数的模型
- **THEN** 真实 Pi 只暴露 `contextWindow > 0` 且 `maxTokens > 0` 的 LiteLLM 模型

#### Scenario: activation 立即改变真实宿主可见模型
- **WHEN** 通过真实 Pi command 依次执行全部启用、全部停用和只启用 default
- **THEN** `get_available_models` 的 LiteLLM provider/model 集合立即对应变化，并持久化选择后的 activation 状态
