import { describe, expect, test } from "bun:test"
import litellm from "./fixtures/litellm-model-info.json" with { type: "json" }
import modelsDev from "./fixtures/models-dev.json" with { type: "json" }
import { mapCapabilities } from "../src/core/index.ts"
import { groupLiteLLMDeployments } from "../src/core/index.ts"
import { selectModelsDevRecord } from "../src/core/index.ts"

const groups = groupLiteLLMDeployments(litellm)
function mapped(modelName: string, contextTierCap = true) {
  const group = groups.find((item) => item.modelName === modelName)!
  return mapCapabilities(group, selectModelsDevRecord(group, modelsDev), contextTierCap)
}

describe("能力映射", () => {
  test("多部署按交集与最小上限保守合并", () => {
    const result = mapped("shared-route")
    // One deployment declares 200k/32k; the other 400k/128k → min for limits.
    expect(result.limit.context).toBe(200000)
    expect(result.limit.output).toBe(32000)
  })

  test("LiteLLM 值优先、价格换算为每百万 token", () => {
    const result = mapped("gpt-6-sol")
    expect(result.cost).toEqual({ input: 2, output: 10, cacheRead: 0, cacheWrite: 0 })
  })

  test("272k 与 512k 阶梯截断，可关闭", () => {
    expect(mapped("gpt-6-sol").limit.context).toBe(272000)
    expect(mapped("minimax-m3").limit.context).toBe(500000)
    expect(mapped("gpt-6-sol", false).limit.context).toBe(922000)
  })

  test("tiered_pricing 首个非零起点截断", () => {
    expect(mapped("tiered-pricing-model").limit.context).toBe(256000)
    expect(mapped("tiered-pricing-model", false).limit.context).toBe(1000000)
  })

  test("无阶梯字段时保持原上限", () => {
    expect(mapped("deepseek-v4.1-flash").limit.context).toBe(1000000)
  })

  test("模态信任名单允许 models.dev 补充 Qwen 输入模态", () => {
    expect(mapped("qwen3.7-plus").capabilities.input).toEqual(["text", "image", "video"])
  })

  test("信任名单只在 LiteLLM 未声明额外模态时生效", () => {
    // mimo-v2.6-pro declares audio/video inputs itself → LiteLLM values are authoritative.
    const result = mapped("mimo-v2.6-pro")
    expect(result.capabilities.input).toEqual(["text", "image", "audio", "video"])
  })

  test("显式 false 覆盖 models.dev 模态", () => {
    const group = groups.find((item) => item.modelName === "glm-5.3")!
    const result = mapCapabilities(group, selectModelsDevRecord(group, modelsDev), true)
    expect(result.capabilities.input).toEqual(["text"])
  })

  test("LiteLLM 缺失输出上限时回退 models.dev", () => {
    const group = groupLiteLLMDeployments({
      data: [
        {
          model_name: "missing-fields-model",
          litellm_params: { model: "openai/missing-fields-model" },
          model_info: { mode: "chat" },
        },
      ],
    })[0]!
    const result = mapCapabilities(group, selectModelsDevRecord(group, modelsDev), true)
    expect(result.limit.output).toBe(65536)
  })

  test("工具调用默认支持", () => {
    expect(mapped("deepseek-v4.1-flash").capabilities.tools).toBeTrue()
  })

  test("异常字段按缺失处理并回退默认值", () => {
    const result = mapped("invalid-fields")
    expect(result.limit).toEqual({ context: 0, input: 0, output: 0 })
    expect(result.capabilities.tools).toBeTrue()
  })
})
