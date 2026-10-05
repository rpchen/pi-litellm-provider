# Design: clarify-endpoint-credential-state-wording

## 背景与约束

`improve-user-visible-state-consistency`（archive 2026-10-05）已把用户可见 credential 状态冻结为
`stored / environment (legacy default 专用) / none / unknown`，且 canonical
`endpoint-state-consistency` 明确规定 "UI copy MUST NOT call a stored credential \"connected\""。

但 canonical `endpoint-management` 的 `Credential management` requirement 以及
`[LIST-MULTI]`、`[ADD-INACTIVE]`、`[DEL-NO-GHOST]` 等 scenario 仍使用旧的
Connected / Not connected 表达。这是规格内部矛盾。

本 change 是 review fix 性质的最小 follow-up：只修正**表达**，不引入任何新产品能力、不改状态机。

## 冻结语义（本 change 重申、不重新设计）

- credential saved ≠ endpoint connected ≠ runtime applied
- 用户可见 credential 状态只有四种：`已保存 API Key` / `未保存 API Key` / `API Key 来自环境变量` / `凭据状态未知`
- `已连接` / `未连接` / `connected` / `disconnected` 不得作为用户可见 credential 状态标签

## 允许保留的 "connection" 用语（不重命名底层概念）

- `连接 API Key` / `Connect`：**操作名称**（按钮、命令项）。
- `连接已切换，等待新 endpoint 完成发现` 等 discovery runtime 状态描述：描述 discovery 轮换，不是 credential 状态标签。
- "connected address"（legacy 迁移语境）：指 legacy `default` 实际配置的地址，不是 credential 状态标签。
- `litellm-connection` capability 中"视为未连接"的 legacy 表达：描述"地址缺失、不注册模型"的 runtime 事实，且该 capability 不在本 delta 范围。

## 决策

### D1: requirement 表达与 canonical 状态对齐

`Credential management` requirement 的状态展示从 "Connected / Not connected" 改为四种
credential 标签，并显式写明 "labels MUST NOT describe a credential as Connected / Not connected"。
受影响 scenario（`[LIST-MULTI]`、`[ADD-INACTIVE]`、`[CRED-CONNECT]`、`[CRED-REPLACE]`、
`[CRED-LOGIN-CONSISTENT]`、`[DEL-NO-GHOST]`）同步改用 saved/not-saved 表达。

### D2: Add 成功 notify

`src/extension/endpoint-management.ts` 的
`已添加 endpoint ${id}（未启用、未连接）。请在列表中选择它来连接 API Key 并启用。`
改为
`已添加 endpoint ${id}（未启用、未保存 API Key）。请在列表中选择它来连接 API Key 并启用。`
"连接 API Key" 是操作名称，保留。

### D3: discovery.ts 内部注释

`src/extension/discovery.ts` 中两处 "Not connected" 注释改为描述事实的表达
（"no address resolved"），不与 credential 状态标签冲突。这只是注释，无行为变化。

### D4: E2E 脚本注释

`scripts/e2e-real-pi.mjs` 中 stage 2 注释 "inactive / not connected" 与 stage 3 注释
"connected, still inactive" 改为按 credential 表达；脚本断言的 on-screen 文案
（`○ e2e-new · 未启用 · 未保存 API Key`、`未启用 · 已保存 API Key`）已经是新语义，不需要改。
错误信息字符串 `new endpoint must be inactive/unconnected` 改为 `inactive/without a saved key`。

### D5: README

Pi README 状态模型与操作说明已使用新语义（`未保存 API Key`、
`凭据状态只描述是否已保存，不等于"已连接"`），无需修改；仅核查确认。

### D6: 测试与负向断言

- `test/endpoint-management.test.ts`：Add 成功后新增对 notify 文案的断言
  `未启用、未保存 API Key`，并新增负向断言：notify 不含 `已连接`/`未连接`/`connected`。
- `test/endpoint-state.test.ts`：已有 `credentialLabel` 不含 `已连接`/`connected` 的负向断言，
  扩展为同时断言 `未连接`/`disconnected` 不出现。
- `test/endpoint-management.test.ts` 的 `[LIST-MULTI]` 测试名
  "active/inactive and connected/not-connected are independent per endpoint" 改为
  saved/not-saved 表达（测试名不是用户可见文案，但保持词汇一致）。

## 明确不做

- 不改 `EndpointState` 结构、七种状态 token、`canPublish`、`canRetry`、Retry 行为、`/models` contract。
- 不改 discovery / recovery / mutation semantics。
- 不改 `litellm-connection` / `pi-integration` 的 legacy 表达（它们描述地址缺失的 runtime 行为，不是 credential 状态标签；如需修正属后续独立提案）。
- 不修改任何旧 archive。