# Design

## 根因

PR9（pi #34）实施时 openspec archive 没有把 change 的 spec delta 合入 canonical specs（canonical 中既没有新建 `multi-endpoint-activation/`，`litellm-connection` 也保持 PR9 前文本），change 目录被移入 archive 后漂移长期未被发现。`scripts/check-openspec-closure.mjs` 只拒绝“tasks 全完成但仍留在 active”的 change，不校验 archived delta 与 canonical 的一致性。

## 权威事实来源

- 实现：`src/extension/config.ts`（`loadEndpointRegistry`：全局-only 配置；显式模式拒绝读取 `LITELLM_BASE_URL`；legacy 字段与 `endpoints` 混用拒绝并告警；注释明确“PR9 intentionally has no project-level endpoint configuration”）。
- 用户文档：`README.md`（配置 / Endpoint activation 两节，已描述 PR9 后行为）。
- 测试证据：`test/config.test.ts`（legacy/env/非法字段/混用拒绝/显式忽略 env）、`test/activation.test.ts`（activation 立即生效与持久化）、canonical `pi-integration` 的真实宿主 E2E Scenario（多 endpoint 凭据隔离、activation 改变可见模型）。

## 变更范围

只改 canonical OpenSpec specs 文本（新增 1 个 capability spec、修改 1 条 requirement），不改实现、不改 README（README 已与新规格一致）、不改任何产品行为。归档的 PR9 change 目录保持原样（历史记录）。

## 不做

- 不重写 `pi-integration` / `discovery-snapshot` 中已由后续 change 正确同步的 endpoint 相关 requirement。
- 不借本次同步扩大 PR9 范围（endpoint CRUD UI 仍不在范围）。
