## Why

`improve-user-visible-state-consistency`（已归档）把用户可见 credential 状态冻结为
`stored / environment (legacy default 专用) / none / unknown`，并禁止把"已保存 credential"称为"已连接"。
但审计发现 canonical `endpoint-management` spec 的既有 requirement 表达仍残留旧的
connection 语义：

- `Credential management` requirement 仍写 "The management UI SHALL show Connected / Not connected per endpoint"。
- `[LIST-MULTI]`、`[ADD-INACTIVE]`、`[DEL-NO-GHOST]`、`[CRED-CONNECT]`、`[CRED-REPLACE]`、`[CRED-LOGIN-CONSISTENT]` 等 scenario 仍把 credential 状态描述成 Connected / Not connected。

这与 canonical `endpoint-state-consistency` 的 "Credential state is not \"connected\"" requirement 直接矛盾。旧 archive 不可变，closure gate 要求 canonical 的变化必须能由 archive history 重放得到，因此需要一个新的最小 follow-up delta。

## What Changes

- 修正 `endpoint-management` 的 `Credential management` requirement 及受影响 scenario 的**表达**：credential 状态标签一律为"已保存 API Key / 未保存 API Key / API Key 来自环境变量 / 凭据状态未知"，不再出现 Connected / Not connected 作为 credential 状态。
- 明确冻结语义不变：credential saved ≠ endpoint connected ≠ runtime applied；`已连接/未连接/connected/disconnected` 不得作为用户可见 credential 状态标签。
- 保留："连接 API Key / Connect" 作为**操作名称**；`/login` 宿主命令名。
- 同步修正实现与测试中残留的旧 wording：
  - `src/extension/endpoint-management.ts` Add 成功 notify 的"未启用、未连接"改为"未启用、未保存 API Key"。
  - `src/extension/discovery.ts` 中"Not connected"内部注释改为不与 credential 状态混淆的表达。
  - README 排障/状态模型相关表述核查（Pi README 已使用新语义，仅核对）。
  - Real Pi E2E 脚本中描述新增 endpoint 状态的注释与断言信息同步（断言的 on-screen 文案本身已是"未保存 API Key"）。

## 不改变的内容（冻结边界）

- `EndpointState = desired × validation × credential × applied` 结构与七种状态 token 不变。
- `canPublish` / `canRetry` / Retry 行为 / `/models` strict contract 不变。
- discovery / recovery / mutation semantics 不变。
- 不重命名底层 SDK / transport 概念；diagnostics 内部工程枚举不改名。

## Impact

- 用户可见文案：endpoint 管理列表状态、Add 成功 notify、diagnostics 注释。
- 无持久化格式、无 API 契约、无状态机变化；`litellm-discovery-core` 不修改。
- 测试：`test/endpoint-management.test.ts`（Add 成功 notify 断言 + 负向断言）、`test/endpoint-state.test.ts`（扩展负向断言）。