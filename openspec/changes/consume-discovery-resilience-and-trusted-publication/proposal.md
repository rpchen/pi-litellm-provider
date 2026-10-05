# Consume discovery resilience and trusted publication

## Why

Core 已经建立的语义是：单模型 publication gate 绝不降低、模型之间隔离失败、metadata 暂时不可用时可以安全复用此前验证过的完整配置、catalog 允许 partial availability。Pi 适配层必须完整消费这套事实，而不是继续保留一条「用户确认后发布不完整模型」的旁路。

当前 Pi 存在的问题：

1. 注册了 `/litellm-accept-degraded`，把 Core 判为可降级的 blocked 模型经用户确认后发布，且 diagnostics 用「未完成 / 降级」两套词汇描述同一种不可信状态；
2. metadata 暂时故障时只显示 LKG 数量，没有解释 LKG 基于哪次可信结果；
3. 没有表达 partial availability、unusable catalog、previously-published regression，也没有区分「新模型首次 withheld」与「此前可用模型被撤下」；
4. 没有 notification suppression：同一组 withheld 问题每次刷新都可能重复打扰。

## What Changes

- **删除 `/litellm-accept-degraded`**：命令注册、handler、usage / 拒绝文案、README 说明、E2E 步骤、测试与 persisted acceptance 状态全部移除；`PublicationController` 不再持有 `acceptedDegradedIDs`。
- 消费 Core 的 **withheld / partial / unusable / regression / LKG / discrepancy / conflict** 事实，并映射到 Pi 的注册结果与 diagnostics。
- 新增 **catalog notice** 机制：regression 与 `0/N` unusable catalog 以 `ctx.ui.notify` 明确呈现（含 Retry 指引），新模型首次 withheld 只在 diagnostics 中可见；acknowledgement 只抑制重复提醒，绝不参与 publication。
- **不新增 `/litellm-acknowledge`**：acknowledgement 只在底层状态层实现（fingerprint + suppression），不暴露独立命令。
- persisted snapshot 仍只包含已发布 spec：withheld 模型不会进入恢复路径。
- README 用「为什么模型会暂时 withheld / partial availability / LKG / Retry / diagnostics」重写相关章节。

## Impact

- Affected specs: `publication`（MODIFIED + REMOVED）、`discovery-resilience-integration`（新增）
- Affected code: `src/extension/index.ts`、`src/extension/discovery.ts`、`src/extension/diagnostics.ts`、`test/publication.test.ts`、`test/discovery.test.ts`、`scripts/e2e-real-pi.mjs`、`README.md`
- 依赖 Core：`catalogFromPublication` / `decideAcknowledgement` / `withheldReasons`（`litellm-discovery-core` 新 SHA）
