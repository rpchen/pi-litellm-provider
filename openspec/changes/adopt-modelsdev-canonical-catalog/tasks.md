# Tasks

> Core 稳定 SHA 前可完成 §1–§4（`verify:dist` 保持零差异，不重建 `dist`）；
> §5（重建 + 新 dist 全验证）BLOCKED，直至 Core PR 合入 `main`。

## 1. Fetch（Pi）

- [x] 1.1 `src/net/fetch.ts`：`MODELS_DEV_URL` 改为 `https://models.dev/catalog.json`；注释说明单请求同 snapshot；其余语义不变
- [x] 1.2 `test/net-fetch.test.ts`：默认 URL 断言更新；fake catalog 改 catalog 形状；unavailable/providers-only 降级路径不断
  - 证据：新增「默认拉取 catalog 快照」「自定义 URL 仍被尊重」；`scripts/e2e-real-pi.mjs` fetch-hook 同时拦截新旧 URL

## 2. LKG 接线（Pi）

- [x] 2.1 `src/extension/discovery.ts` `seedPublicationLKG`：透传 live catalog + build options 给 `createLastKnownGoodEntry`；保持 best-effort try/catch
- [x] 2.2 纵向测试：fixture（含 canonical + serving + unresolved + LiteLLM-only）→ discovery → store 中 v8 条目（Core ≥ 8 时断言 schemaVersion + proof；旧 Core 时仅断言接线不抛错）；v7 内存条目在新 Core 下被忽略并重捕获
  - 证据：`publication.test.ts` v7/v8 双轨（`CORE_V8` 门控，旧 Core 跑 v7 用例、新 Core 跑 v8 用例；双 Core 全绿已验证）

## 3. Diagnostics 展示（Pi）

- [x] 3.1 `/litellm-diagnostics` 模型详情：canonical identity/evidence、serving status/provider/record、档位状态 + 恢复提示、operator-configuration 键、诊断候选、catalog shape；缺失字段省略
  - 证据：`formatModelDetails`（新旧 Core 形状兼容）+ 接入 `formatProviderDiagnostics`
- [x] 3.2 展示测试：手造新旧两种诊断形状（新 Core 全字段 / 旧 Core 缺失）分别渲染断言；纵向链路测试不断（command → `ctx.ui.notify` 仍含 withheld 原因）

## 4. 文档与治理（Pi）

- [x] 4.1 README：catalog URL、`models_dev_provider` + 精确 SKU（恢复 serving 值）、operator configuration 与晋升门槛、行为变化清单（DeepSeek/档位/kimi-k3/无收窄/LiteLLM-only/serving 缺字段/LKG v8）、迁移说明
- [x] 4.2 OpenSpec：本 change proposal/design/tasks + specs deltas（`model-discovery`、`provider-diagnostics`、`publication`）；`openspec validate --all --strict` 通过
- [x] 4.3 提交前门禁：`bun run typecheck`、`bun test`（旧 Core 388 pass / 新 Core 9328706 329 pass，双轨全绿）、`bun run test:package`、`npm run validate:spec`、`test:openspec-closure`、`test:release-metadata`、`test:scenario-coverage` 通过；`bun run verify:dist` 在本 PR 为预期红（src 已按新设计修改，`dist/` 保持旧 Core，差异即本次 src 变更；§5 重建后恢复零差异）；删除 `test/core-*.test.ts` 副本与快照（Core 算法只在 Core 仓测试，adapter 不重复覆盖）
- [ ] 4.4 Real Pi 0.87.1 E2E（旧 dist，宿主契约回归）：通过则记证据；环境阻断则明确记录未运行项，交 CI 验证

## 5. Core 稳定 SHA 后（BLOCKED：等 Core PR 合入 main）

- [ ] 5.1 `bun run build:dist` 取稳定 Core SHA → `dist/` + `dist/core-provenance.json` 更新 → `bun run verify:dist` 零差异复验
- [ ] 5.2 全门禁复验（typecheck/tests/package/validate:spec）+ Real Pi 0.87.1 E2E（新 dist）+ README 版本核对
- [ ] 5.3 与 Core PR、OpenCode PR 互链；archive + canonical sync + strict validation
