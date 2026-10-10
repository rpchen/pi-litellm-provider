# Design: Adopt the models.dev Canonical Catalog (Pi adapter)

> 本 change 是 Core `adopt-modelsdev-canonical-catalog` 的下游适配；业务语义以
> Core 的 design/specs/acceptance 为准，这里只定 Pi 宿主边界。

## Context

- Core：`design/adopt-modelsdev-canonical-catalog` 分支（待合入 `main`）；
  Pi：`main@2f82181`（provenance Core `f07951d7`）。
- Pi 通过 `src/core/`（构建期生成、gitignore）消费 Core 公共入口；
  `dist/` 为已提交产物，`verify:dist` 按 provenance SHA 重建比对。

## Goals / Non-Goals

**Goals**

1. 生产默认拉取 `catalog.json`（与 Core 同 shape、同 failure domain）。
2. LKG seeding 走 schema 8 同 resolution 派生；旧条目 fail closed 后重捕获。
3. 诊断把 Core 新事实（identity/serving/档位/operator-config/候选/shape）
   呈现给运维者；缺失时省略。
4. 所有用户可见变化进 README；纵向链路不断（fixture → discovery → Core
   diagnostics → adapter state → command → `ctx.ui.notify`）。

**Non-Goals**

- 不重测 Core 算法（identity/authority/merge/LKG 判定只在 Core 测）。
- 不新增 Pi 配置项；不改变 credential/login、endpoint 管理、refresh 语义。
- 不在本 PR 重建 `dist`（等 Core 稳定 SHA，见 tasks BLOCKED）。

## Decisions

### D1 Fetch

- `MODELS_DEV_URL = "https://models.dev/catalog.json"`；60 s 超时、6 h TTL、
  60 s retry、失败降级 `{}`（触发 Core unavailable/LiteLLM-only + LKG 路径）不变。
- 自定义 URL 能力不受影响（Pi 无 modelsDevUrl 配置；E2E/单测注入 fake 即
  catalog 形状；provider-only 镜像由 Core 按 D2 fail closed 并诊断提示）。

### D2 LKG 接线

- `seedPublicationLKG(store, litellmResponse, publication, catalog, buildOptions, now)`：
  逐 publishable（`status === "configured"`）调
  `createLastKnownGoodEntry(group, selected, spec, now, captured, catalog, buildOptions)`；
  保持 try/catch best-effort（seeding 永不失败 discovery）。
- 新 Core 下 capture 与 gate 同源（5.3）；旧 Core 下多传的 catalog/options 参数
  被兼容接受（旧签名本就可选），行为保持旧版。v7 内存条目在新 Core 下判不兼容。
- Pi 不持久化 LKG 条目（per-session 内存 store）；publication memory
  （acknowledgement/baseline）形状不变。

### D3 Diagnostics 展示

- `/litellm-diagnostics <endpoint>` 模型详情新增（有则显示、无则省略）：
  `canonical <id>（<evidence>）`、`serving <status> [provider → record]`、
  `reasoning levels <unknown|known[...]>`（unknown 时附恢复提示：声明
  `models_dev_provider`）、`operator configuration：<keys>`（明确不是 enforcement）、
  `candidates: <provider/record → models_dev_provider>`、`catalog <kind>`。
- `serving-record-unresolved` / `declared-unmatched` 以 warning 行提示可操作修复
  （精确 wire id 或改声明）。

## Risks

- Core 未合入前 `dist` 仍是旧 Core：本 PR 的展示代码对缺失字段必须省略而非
  崩溃（测试用新旧两种诊断形状覆盖）。
- `catalog.json` 比 `api.json` 大 ~7.7%（5.74 MB）：超时/缓存不变，已评估可接受。
- 真实宿主 E2E（Real Pi 0.87.1）在本 PR 以旧 `dist` 验证宿主契约回归；
  新 `dist` 的 E2E 在重建后另行执行（BLOCKED）。

## Migration Plan

1. 本 PR：源码 + 测试 + README + OpenSpec（不碰 `dist/`）。
2. Core 合入 `main` 后：`build:dist` 取稳定 SHA → `verify:dist` → 复验全门禁 →
   另起提交/PR（含 Real Pi E2E vs 新 dist）。
