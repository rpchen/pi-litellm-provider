# Persist publication memory across restarts

## Why

Pi 的 acknowledgement/baseline 只保存在进程内存里：宿主重启后同一组 withheld 问题会被重新当成首次观察。阶段一 spec 只要求「同一问题集合不重复打扰」，没有写跨重启；本轮按 Core 新增的 `PublicationMemory` 补齐 Pi 的持久化与验证。

## What Changes

- Pi 通过 host-persisted catalog payload 持久化 Core 的 `PublicationMemory`（每 endpoint 一份），并在每次刷新前恢复；`asStoredCatalog` 必须保留该字段，否则持久化会静默失效。
- 新增/更新的 spec 要求：同一 fingerprint 跨重启不重复提醒；改善静默并更新基线；完全恢复清除；新问题/原因变化/regression 重新提醒；损坏记录不改变 publication。
- diagnostics 增加提醒状态行（「该问题集合已确认（跨重启保留），不重复提醒」/「问题集合较已确认状态减少，基线已更新」），让用户可解释为什么不再被重复打扰。
- Real Pi E2E 新增：持久化写入可见（host store JSON）、重启后不重复提醒、material change 后重新提醒。

## Impact

- Affected specs: `discovery-resilience-integration`（MODIFIED）
- Affected code: `src/extension/discovery.ts`、`src/extension/diagnostics.ts`、`test/discovery.test.ts`、`scripts/e2e-real-pi.mjs`
- 依赖 Core：`PublicationMemory` / `parsePublicationMemory` / `serializePublicationMemory` / `nextPublishedBaseline`（新 SHA）
