import { describe, expect, test } from "bun:test"
import modelsDev from "./fixtures/models-dev.json" with { type: "json" }
import { groupLiteLLMDeployments } from "../src/core/index.ts"
import {
  buildVariants,
  candidateModelIDs,
  releaseTimestamp,
  selectModelsDevRecord,
  selectModelsDevRecordDetailed,
} from "../src/core/index.ts"

function one(modelName: string, model: string, info: Record<string, unknown> = {}) {
  return groupLiteLLMDeployments({
    data: [{ model_name: modelName, litellm_params: { model }, model_info: { mode: "chat", ...info } }],
  })[0]!
}

describe("models.dev 记录选择", () => {
  test("候选顺序为 base_model、去路由前缀、model_name", () => {
    expect(candidateModelIDs(one("route-name", "openai/upstream", { base_model: "base" }))).toEqual([
      "base",
      "upstream",
      "route-name",
    ])
  })

  test("没有可验证 identity 时不因名字选择原厂", () => {
    const selected = selectModelsDevRecord(
      one("minimax-m3", "openai/minimax-m3", { base_model: "minimax-m3" }),
      modelsDev,
    )
    expect(selected?.providerID).not.toBe("minimax")
    expect(selected?.selectionSource).not.toBe("legacy-family-compatibility")
  })

  test("原厂缺失时使用 OpenCode Zen", () => {
    const selected = selectModelsDevRecord(one("kimi-k2.6", "openai/kimi-k2.6"), modelsDev)
    expect(selected?.providerID).toBe("opencode")
  })

  test("显式 models_dev_provider 覆盖家族识别", () => {
    const selected = selectModelsDevRecord(
      one("route", "openai/glm-fallback", { models_dev_provider: "zhipuai" }),
      modelsDev,
    )
    expect(selected?.providerID).toBe("zhipuai")
  })

  test("只有多个转售商时不选择记录，且不模糊去后缀", () => {
    expect(selectModelsDevRecord(one("shared-model", "custom/shared-model"), modelsDev)).toBeUndefined()
    expect(selectModelsDevRecord(one("gpt-5.5-free", "openai/gpt-5.5-free"), modelsDev)).toBeUndefined()
  })

  test("原厂备选 provider（-cn）在无原厂记录时生效", () => {
    const selected = selectModelsDevRecord(one("kimi-cn-only", "openai/kimi-cn-only"), modelsDev)
    expect(selected?.providerID).toBe("moonshotai-cn")
    expect(selected?.modelID).toBe("kimi-cn-only")
  })

  test("同名多部署指向不同模型时保持冲突，不按部署顺序取首个", () => {
    const group = groupLiteLLMDeployments({
      data: [
        {
          model_name: "route",
          litellm_params: { model: "openai/first" },
          model_info: { mode: "chat", base_model: "gpt-5.5" },
        },
        {
          model_name: "route",
          litellm_params: { model: "openai/second" },
          model_info: { mode: "chat", base_model: "gpt-6-sol" },
        },
      ],
    })[0]!
    expect(candidateModelIDs(group)).toEqual(["gpt-5.5", "first", "gpt-6-sol", "second", "route"])
    // Candidate order still lists deployment ids, but a group whose
    // deployments provably name different models must not pick the first
    // candidate as the shared identity.
    expect(selectModelsDevRecordDetailed(group, modelsDev).outcome).toBe("ambiguous")
    expect(selectModelsDevRecord(group, modelsDev)).toBeUndefined()
  })
})

describe("推理档位", () => {
  test("effort 档位保留全部取值", () => {
    const selected = selectModelsDevRecord(one("gpt-5.5", "openai/gpt-5.5"), modelsDev)
    expect(buildVariants(selected, "responses").map((variant) => variant.id)).toEqual([
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
    ])
  })

  test("Messages budget 生成 high 与 max，无 max 时只生成 high", () => {
    const withMax = selectModelsDevRecord(one("claude-sonnet-4-5", "anthropic/claude-sonnet-4-5"), modelsDev)
    const withoutMax = selectModelsDevRecord(one("claude-opus-4-1", "anthropic/claude-opus-4-1"), modelsDev)
    expect(buildVariants(withMax, "messages")).toEqual([
      { id: "high", settings: { thinking: { type: "enabled", budgetTokens: 16000 } } },
      { id: "max", settings: { thinking: { type: "enabled", budgetTokens: 64000 } } },
    ])
    expect(buildVariants(withoutMax, "messages")).toEqual([
      { id: "high", settings: { thinking: { type: "enabled", budgetTokens: 16000 } } },
    ])
  })

  test("声明最大值小于 16000 时 high 取该值且不再生成 max", () => {
    const record = {
      providerID: "x",
      modelID: "m",
      record: { reasoning_options: [{ type: "budget_tokens", max: 8000 }] },
    }
    expect(buildVariants(record, "messages")).toEqual([
      { id: "high", settings: { thinking: { type: "enabled", budgetTokens: 8000 } } },
    ])
  })

  test("toggle 与非 Messages budget 不生成档位", () => {
    const toggle = selectModelsDevRecord(one("glm-5.3", "openai/glm-5.3"), modelsDev)
    const budget = selectModelsDevRecord(one("claude-sonnet-4-5", "anthropic/claude-sonnet-4-5"), modelsDev)
    expect(buildVariants(toggle, "chat")).toEqual([])
    expect(buildVariants(budget, "chat")).toEqual([])
  })

  test("无选中记录时不生成档位", () => {
    expect(buildVariants(undefined, "chat")).toEqual([])
  })
})

describe("release_date", () => {
  test("字符串日期解析为 Unix 毫秒", () => {
    const selected = selectModelsDevRecord(one("gpt-5.5", "openai/gpt-5.5"), modelsDev)
    expect(releaseTimestamp(selected)).toBe(Date.parse("2026-03-01"))
  })

  test("数字原值直接返回，缺失为 0", () => {
    expect(releaseTimestamp({ providerID: "x", modelID: "m", record: { release_date: 1700000000000 } })).toBe(
      1700000000000,
    )
    expect(releaseTimestamp(undefined)).toBe(0)
  })
})
