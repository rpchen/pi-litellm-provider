# Design: Pi consumption of discovery resilience

## D1. 适配层只做映射

Pi 不复制任何 publication / LKG / evidence 判定：`buildPublicationResult` 决定 `publishable(model)`，`catalogFromPublication` 决定 catalog 事实，`withheldReasons` 决定原因列表，`decideAcknowledgement` 决定是否提醒。适配层只负责把它们映射到 Pi 的 provider 注册、`ctx.ui.notify` 与 `/litellm-diagnostics`。

## D2. 注册集合

```ts
toProviderModelsWithPublication(publication.publishable, rootURL)
```

`publication.publishable` 只含 `configured` / `configured-lkg`。此外保留 adapter 侧 operational-limits guard（`context > 0 && output > 0`）作为纵深防御。withheld 模型不进入 provider model list，也不进入持久化 snapshot（`snapshotSpecs` 直接取 published specs）。

## D3. PublicationSummary（diagnostics 事实面）

`PublicationSummary` 改为携带：`discovered`、`publishable`、`lkgIDs` + `lkgDetail`、`withheld`（id / status / reasons / previouslyPublished / retryable）、`partial`、`unusable`、`regressions`、`discrepancies`、`conflicts`、`failureKind`、`acknowledgement`。

`formatPublicationSummary` 依次输出：总量、unusable / partial 说明、failure kind、regression 行、LKG 行（含来源与 age）、逐模型 withheld 原因（最多 5 行）、discrepancy / conflict 行。

## D4. 提醒与 acknowledgement

- `decideAcknowledgement` 在成功刷新路径执行，结果写入 `PublicationController.acknowledgement`；`previouslyPublished` 更新为本次实际发布的模型集合。
- 需要提醒时写 `pendingNotice`，由 polling 回调在同一次刷新后用 `ctx.ui.notify` 消费一次（`takePendingNotice`），避免重复打扰。
- `catalogNotice` 只处理 `regression` / `catalog-unusable` / `new-issues`；`first-observation` 与 `unchanged` / `improved` 一律静默。
- acknowledgement 是纯数据：`publication` 分区在没有它时完全一致（测试断言）。
- **不新增 slash command**：Pi 的 command API 没有「查看 diagnostics 后就地确认」的安全上下文动作，因此只实现底层 suppression；`/litellm-diagnostics` 是唯一查看入口。

## D5. 删除 accept-degraded

- `index.ts`：删除命令注册与 handler（含 usage 文案）。
- `diagnostics.ts`：`PublicationController` 去掉 `acceptedDegradedIDs`；`PublicationBlockedModel.degradationEligible/degradationReason` 一并删除（不再存在 eligibility 概念）。
- `discovery.ts`：`DiscoveryDeps.publication` 去掉 `acceptedDegradedIDs`。
- 旧 persisted 状态：acceptance 从未持久化（原实现是内存 Set，重启即失效），因此没有需要迁移的 state；持久化 snapshot 也从未包含 degraded spec（原实现对 `degraded` 做了过滤）。旧 `models-store.json` 中的 `models` 数组只用于非恢复路径，且恢复只读 `snapshot`，因此不存在 degraded override 复活路径。
- README / E2E / 测试中的 accept-degraded 说明与步骤全部移除。

## D6. README

以用户语言说明：模型为什么可能暂时 withheld（identity / metadata / conflict / incomplete / illegal），partial availability 的含义，metadata 暂时不可用时如何用已验证配置继续工作，Retry 如何使用，diagnostics 怎么看，以及「已可信的其他模型不受影响」。README 不写内部状态机。
