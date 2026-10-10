# Adopt the models.dev Canonical Catalog (Pi adapter)

## Why

Core change `adopt-modelsdev-canonical-catalog`（`rpchen/litellm-discovery-core`）
重写了 models.dev 消费模型：canonical registry（`catalog.models`）+ serving
proof（`catalog.providers` + `models_dev_provider` + exact SKU），未证明记录零供给，
Proven Runtime Enforcement 空证明集，LKG schema 8。Pi 仍从 `api.json` 拉取、
按旧 Core SHA 构建，不跟进则：新 Core 行为（DeepSeek 384000、档位 unknown、
无收窄）无法到达用户；旧 `dist` 与新 publication 语义漂移。

## What Changes

- `src/net/fetch.ts` 默认 URL 由 `https://models.dev/api.json` 改为
  `https://models.dev/catalog.json`（单请求、同 snapshot、同 TTL epoch；
  超时/重试/缓存语义不变）。Core 负责形状校验与全部 identity/authority/merge。
- LKG 接线迁移到 schema 8：`seedPublicationLKG` 传递 live catalog + build
  options，使 capture 由同一 resolution 派生；v7 及更早条目由 Core 判不兼容
  （fail closed），下一轮 live 自动重捕获。Pi 不复制 proof 判定。
- `/litellm-diagnostics` 展示新增字段：canonical identity / evidence、
  serving status-provider-record、推理档位状态（unknown/known）、
  operator-configuration 键（不称 enforcement）、诊断候选
  （可声明的 `models_dev_provider`）、catalog shape（complete/providers-only/
  unavailable）。字段缺失时（旧 Core）优雅省略，不崩溃。
- Fake catalog fixture 改为 catalog 形状（`{ providers, models }`），覆盖
  canonical + declared-serving + unresolved + LiteLLM-only 四态。
- README 同步行为变化（DeepSeek/档位/enforcement/输入补缺/LKG v8/目录 URL）。

**BREAKING（用户可见）**：见 Core README 迁移说明；Pi 侧无新增配置项，
`dist` 重建前行为保持旧 Core（provenance 未变）。

## Impact

- Affected specs：`model-discovery`（ADDED：catalog URL 与形状）、
  `provider-diagnostics`（ADDED：诊断字段）、`publication`（ADDED：LKG v8 接线）。
- Affected code：`src/net/fetch.ts`、`src/extension/discovery.ts`
  （seeding 接线）、`src/extension/diagnostics.ts`（展示）、`test/` fixtures 与映射测试、
  `README.md`。
- Downstream顺序：本 change 与 Core PR 并行评审；`build:dist`（`dist/` +
  `dist/core-provenance.json`）必须等 Core 合入 `main`、以稳定 SHA 重建后另行
  提交（BLOCKED 项见 tasks）。在此之前 `verify:dist` 保持零差异。
- 不复制 Core 业务算法；Core 行为由 Core 侧测试覆盖，本仓库只测 Pi 映射
  （Core 结果 → provider 注册/命令/UI/持久化）。
