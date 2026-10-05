## Why

当前用户可见状态与真实运行状态存在系统性不一致：

- endpoint 只有 `active: boolean` 两态；runtime apply 失败（credential 缺失、URL 无法规范化、首次 discovery 失败）时用户看到的仍是"已启用"，无法解释 `/models` 为空的原因。
- `/litellm-endpoints` 列表把"已保存 credential"显示为"已连接"，把 credential exists / credential verified / endpoint reachable / endpoint applied 混为一谈。
- 配置非法的 endpoint 被 `loadEndpointRegistry` 静默丢弃，从管理中心与 diagnostics 里彻底消失；用户无法知道自己的配置哪里错。
- 持久化 snapshot 中存在但当前 endpoint 已停用/apply 失败的模型仍可能进入 `/models`（restore 路径用 snapshot 重放）。
- `/litellm-diagnostics <endpoint-id>` 对未激活 endpoint 只输出占位，无法回答"它到底处于 Enabled·Needs authentication、Enabled·Not applied、Enabled·Error 还是 Disabled·Invalid configuration"。
- 启用失败后没有 Retry 入口，用户只能 disable 再 enable。

冻结的产品原则：**配置表达用户意图，runtime 表达现实；UI 必须诚实展示两者，而 `/models` 只承诺现实**。

## What Changes

- 新增独立的 canonical **endpoint state 状态模型**：`desired`（enabled/disabled）× `validation` × `credential` × `applied`，派生出 `Enabled · Active`、`Enabled · Needs authentication`、`Enabled · Not applied`、`Enabled · Error`、`Enabled · Invalid configuration`、`Disabled`、`Disabled · Invalid configuration` 七种用户可见状态。
- `loadEndpointRegistry` 不再静默丢弃非法 endpoint；保留原始定义，把 validation 状态暴露给上层。
- 管理中心列表 / endpoint detail / `/litellm-diagnostics` / `/litellm-audit-export` 全部改为从该 canonical state 派生标签；credential 状态文案从"已连接"改为"已保存 API Key"/"需要认证"等不再混淆"connected"语义。
- `/models`（即 `refreshModels` 返回的模型清单）只包含：desired=enabled ∧ validation=ok ∧ credential=ok ∧ 最近一次 apply 成功 的 endpoint 的当前 discovery 结果；其余状态一律返回空列表，且 snapshot 重放也只在同样条件下允许。
- 新增 `Retry / Apply again` 入口：当 `desired=enabled` 且 applied≠active 时，用户可直接在 endpoint detail 选择 Retry，触发该 endpoint 的 refresh；无需先 disable 再 enable。
- Diagnostics endpoint detail 不再退化为三行模板：任何状态（含 disabled / invalid）都给出完整字段（desired / validation / credential / applied / last error / last discovery / 当前 registered models）。
- 本轮**不**实现：endpoint 完整 CRUD UI 之外的字段编辑、项目级 endpoint、protocol/pollInterval/contextTierCap UI、持续 health monitoring、自动 backoff/retry、discovery cancellation overhaul、mutation transaction hardening、release pipeline redesign。

## Capabilities

### New Capabilities
- `endpoint-state-consistency`: 规范化 desired / validation / credential / applied 的四元组模型，统一管理中心、diagnostics、`/models` 可见性与 Retry 入口。

### Modified Capabilities
- `multi-endpoint-activation`: activation 仍只表达 desired enabled/disabled；文档与测试明确它不再被 runtime apply 反向污染（runtime 失败不回滚 persisted activation）。
- `endpoint-management`: 列表/详情从单一 boolean `active` 改为显示完整派生状态标签；新增 Retry 操作；Add/Edit 的 URL 校验与运行时 `normalizeLiteLLMURL` 显式对齐为同一份语义。
- `provider-diagnostics`: `/litellm-diagnostics <endpoint-id>` 对任意状态 endpoint 输出完整的 canonical state + 最近错误，而不是只有 active 才能看详情。

## Impact

- **使用的 Pi 扩展 API**：`registerProvider/unregisterProvider`、`refreshModels`、`ctx.modelRegistry.refresh`、`ctx.ui.select/confirm/input/notify`、`registerCommand`、`pi.on("session_start"/"session_shutdown")`。兼容区间仍为 Pi >=0.87.1（Real Pi E2E 固定 0.87.1）。
- **与共享 core 的边界**：core 不修改。endpoint id 模式与 URL 语义继续复用 core 的 `isEndpointID` / `normalizeLiteLLMURL`；desired state、credential 状态、applied state、用户可见标签与 Retry 全部属于 Pi 宿主边界。
- **持久化**：`litellm.activation.json` 语义不变；新增 per-endpoint `applied` 内存状态由 extension 进程持有，不落盘。`litellm.json` 文件格式不变化；之前会"静默丢弃非法 endpoint"改为"加载并标记 invalid"。
- **测试隔离**：继续使用 `bunfig.toml` preload 的 `PI_CODING_AGENT_DIR` 隔离；新增测试注入 `agentDir` 与 fake `ui`/`modelRegistry`。
- **README**：管理中心与 diagnostics 章节需要同步描述新状态标签；所有 JSON/JSONC 示例审计为 strict JSON / 标注 jsonc。
- **与 OpenCode 侧的协同**：两侧在同一周末内交付相同的产品语义；`opencode-litellm-provider` 有对应的 `improve-user-visible-state-consistency` change，使用相同的状态词汇表。
