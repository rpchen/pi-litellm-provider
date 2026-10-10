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
- [x] 4.4 Real Pi 0.87.1 E2E（旧 dist，宿主契约回归）：通过（2026-10-08，隔离安装 `@earendil-works/pi-coding-agent@0.87.1` 于 `%TEMP%\litellm-e2e-fixed\pi`，`PI_BIN` 注入，不改全局 Pi 1.0.4；`E2E_PACKAGE_SPEC=git:github.com/rpchen/pi-litellm-provider@ba4fe3dbac363b409e0488b9e0699d65e189bfb7`）：安装/凭据/模型注册与 limits/diagnostics/LKG/route-change regression+unusable 提醒/自动恢复/endpoint 管理全套（add/edit/connect/activate/replace/disconnect/deactivate/delete/重启）/ack 重启持久化全绿；E2E catalog stub 已做 era 感知（v7 dist → provider map；v8 dist 重建后 → catalog registry，G30 下 e2e wire id 需要 registry 条目才能发布）

## 5. Core 稳定 SHA 后

- [x] 5.1 `bun run build:dist` 取稳定 Core SHA → `dist/` + `dist/core-provenance.json` 更新 → `bun run verify:dist` 零差异复验
  - 证据：Core `a13f16fd983478572502f3896fd5509978027261`；artifact digest `sha256:0c8083eb4d8b47e224b425daee9369b97b0eeef9e48536d0c812191f949e9cac`；`verify:dist` 105→70 文件零差异
- [x] 5.2 全门禁复验（typecheck/tests/package/validate:spec）+ Real Pi 0.87.1 E2E（新 dist）+ README 版本核对
  - 证据：`typecheck`、`bun test`（329 pass / 9 skip / 0 fail）、`test:package`、`validate:spec`、`test:scenario-coverage`（43/43）、`test:openspec-closure`、`test:release-metadata`（v0.9.0）全绿；Real Pi E2E 迁移到冻结 v8 语义（catalog outage → LKG 恢复、route-change 回退、fail-closed 指纹拒绝），本地固定 Pi 0.87.1 与 CI `Real Pi 0.87.1 E2E`（run 37904224366 @ `57b9b32`）全绿
- [x] 5.3 与 Core PR、OpenCode PR 互链；archive + canonical sync + strict validation
  - 证据：Core PR rpchen/litellm-discovery-core#32 已合入 core `main`（`a13f16fd983478572502f3896fd5509978027261`）；本 PR #52 经 squash + HEAD SHA 匹配保护合入 `main`（2026-10-10，merge commit `21b66ef2ba2eaab86accafec3bfed7266e4bfb8b`，PR HEAD `cfbf380`），合入后 main CI（run 38010119930，`CI` + `Real Pi 0.87.1 E2E`）全绿，`Publish main index`（run 38010246548）发布 `21b66ef` 的不可变索引快照；OpenCode PR rpchen/opencode-litellm-provider#60 同日以 squash 合入其 `main`（merge commit `60bfe2c2076e2b33b86f39007e9bd30797dcde35`）。`openspec archive adopt-modelsdev-canonical-catalog` 完成归档并同步 canonical specs（`model-discovery`、`provider-diagnostics`、`publication`）；归档后 `openspec validate --all --strict --no-interactive`、`test:openspec-closure`、`test:scenario-coverage`、`test:release-metadata`、`bun run typecheck`、`bun test`、`bun run test:package`、`bun run verify:dist` 全绿（真实宿主契约无变化，Real Pi 0.87.1 E2E 由本治理 PR 的 CI 门禁覆盖）。
