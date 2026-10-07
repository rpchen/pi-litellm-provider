# Consume Canonical Provider Selection Precedence Fix

## Why

Core 仓库 `litellm-discovery-core` 的 OpenSpec change `fix-canonical-provider-selection-precedence`（对应 Core PR rpchen/litellm-discovery-core#29 + 后续 rule-B 补全 #30，Core main SHA `f07951d7ac85f756bba8cfa64fa5215de0dad664`）修复了通用 canonical provider selection：

1. **真实 BUG**：Pi 用户选择 `deepseek-v4.1-flash` 时被 LiteLLM 拒绝——`max_tokens (943718) exceeds model's maximum output tokens (393216)`。Core 旧 selector 未把 DeepSeek 官方 provider 的 serving-SKU 记录（通过 `canonical_model_id` 关系指向 canonical identity）识别为 canonical-original，fallback 落到 OpenRouter，并把 reseller serving limit `943718` 当成模型内禀高权威事实发布，Pi `toProviderModels` 忠实映射为 `maxTokens=943718`。
2. Provider selection precedence 修正为：explicit provider proof > canonical-original > OpenCode > OpenRouter > unique trusted match > ambiguous。
3. fallback record（reseller serving metadata）不再作为 authoritative intrinsic 事实，只补缺；与 LiteLLM 描述性声明同级冲突时 withheld。

Pi 的职责边界不变：`map.ts` 的 `spec.limit.context → contextWindow`、`spec.limit.output → maxTokens` 映射本身正确，无需业务源码修改。Pi 需要的是拉取修复后的 Core SHA（`build:dist`）并提供「Core publication → Pi host config」的 DeepSeek 固定 regression coverage，证明最终宿主配置 `maxTokens=393216`、且不再出现 `943718`。

## What Changes

- 通过 `build:dist` 把 `dist/` 更新到修复后的 Core SHA（同一解析 SHA 全程复用；更新 `dist/core-provenance.json` 与 runtime identity digest）。
- 新增 integration regression（复用 Core 固定 fixture 数据形态，无模型特判）：真实 LiteLLM model_info + 真实 catalog 形态 → Core `buildPublicationResult` → Pi `toProviderModelsWithPublication`：
  - `contextWindow === 1000000`（DeepSeek 官方 context），`maxTokens === 393216`；
  - 强负断言 `maxTokens !== 943718`；
  - fallback-only catalog（OpenRouter 943718）下模型 withheld、注册列表不含该模型；
  - 无官方记录且 OpenCode/OpenRouter 同时存在时 fallback = OpenCode，且 canonical identity（spec.id）不被改写。
- OpenSpec 立案跟踪上述集成行为；不改变 Pi 其余行为。
- Real Pi 0.87.1 E2E 继续作为宿主契约门禁跑在完整 CI 上。

## Impact

- 关联 change：`litellm-discovery-core` `fix-canonical-provider-selection-precedence`（PR #29 必须先合入 main 产生稳定 SHA）；`opencode-litellm-provider` 对应集成 change 并行推进。
- Affected specs: `discovery-resilience-integration`（MODIFIED）、`publication`（MODIFIED）
- Affected code: 仅 `dist/`（Core SHA 更新）与测试；Pi 业务源码 `src/` 零改动。