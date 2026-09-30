# Tasks

- [x] 依据归档的 PR9 delta 在 canonical specs 新增 `multi-endpoint-activation` capability（4 条 requirement），并补写真实 Purpose。证据：requirement 与 `openspec/changes/archive/2026-09-29-pr9-multi-endpoint-activation/specs/multi-endpoint-activation/spec.md` 一致；行为证据见 `test/config.test.ts`（global registry、legacy zero-migration）、`test/activation.test.ts`（independent activation）、`test/discovery.test.ts` + `test/diagnostics.test.ts`（endpoint 隔离），以及 canonical `pi-integration` 的真实宿主 E2E Scenario。
- [x] 修改 canonical `litellm-connection` 的地址解析 requirement：全局-only、显式模式忽略 `LITELLM_BASE_URL`、禁止项目级配置、禁止 legacy 与 `endpoints` 混用；移除“项目级覆盖全局”Scenario。证据：`test/config.test.ts` 中 legacy/env/非法字段/混用拒绝/显式忽略 env 用例。
- [x] 运行 strict OpenSpec validation（changes + specs）通过。
- [x] 通过 OpenSpec CLI archive 本 change，再次 strict validation。
