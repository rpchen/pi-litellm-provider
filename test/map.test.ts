import { describe, expect, test } from "bun:test"
import litellm from "./fixtures/litellm-model-info.json" with { type: "json" }
import modelsDev from "./fixtures/models-dev.json" with { type: "json" }
import { buildModelSpecs, hasOperationalLimits, type ModelSpec } from "../src/core/index.ts"
import { PROTOCOL_API, thinkingLevelMapFor, toProviderModels } from "../src/extension/map.ts"

const specs = buildModelSpecs(litellm, modelsDev, { contextTierCap: true, protocolOverrides: {} })
const ROOT = "http://litellm.example:4000"
const models = toProviderModels(specs, ROOT)
const byID = new Map(models.map((model) => [model.id, model]))

/** Minimal spec factory for focused thinkingLevelMap tests. */
function spec(variants: ModelSpec["variants"], protocol: ModelSpec["protocol"] = "chat"): ModelSpec {
  return {
    id: "m",
    name: "m",
    protocol,
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    variants,
    released: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    limit: { context: 1000, input: 1000, output: 100 },
  }
}

describe("protocol -> pi-ai api mapping", () => {
  test("maps every LiteLLM protocol to a pi-ai API id", () => {
    expect(PROTOCOL_API.chat).toBe("openai-completions")
    expect(PROTOCOL_API.responses).toBe("openai-responses")
    expect(PROTOCOL_API.messages).toBe("anthropic-messages")
  })

  test("has no unmapped protocol", () => {
    expect(Object.keys(PROTOCOL_API).sort()).toEqual(["chat", "messages", "responses"])
  })
})

describe("toProviderModels", () => {
  test("只发布具备正数 context/output 的 operational spec", () => {
    const operational = specs.filter(hasOperationalLimits)
    expect(models).toHaveLength(operational.length)
    expect(models.map((model) => model.id)).toEqual(operational.map((item) => item.id))
  })

  test("api 按协议逐模型设置", () => {
    expect(byID.get("gpt-6-sol")?.api).toBe("openai-responses")
    expect(byID.get("mimo-v2.6-pro")?.api).toBe("openai-completions")
    expect(byID.get("claude-db")?.api).toBe("anthropic-messages")
  })

  test("messages 模型用根地址，chat/responses 用 /v1 地址", () => {
    expect(byID.get("claude-db")?.baseUrl).toBe(ROOT)
    expect(byID.get("claude-bedrock")?.baseUrl).toBe(ROOT)
    expect(byID.get("gpt-6-sol")?.baseUrl).toBe(`${ROOT}/v1`)
    expect(byID.get("mimo-v2.6-pro")?.baseUrl).toBe(`${ROOT}/v1`)
  })

  test("input 只保留 text/image", () => {
    expect(byID.get("mimo-v2.6-pro")?.input).toEqual(["text", "image"])
    expect(byID.get("glm-5.3")?.input).toEqual(["text"])
  })

  test("cost 与上限来自发现结果", () => {
    const sol = byID.get("gpt-6-sol")!
    expect(sol.cost.input).toBe(2)
    expect(sol.cost.output).toBe(10)
    expect(sol.contextWindow).toBe(272000)
    expect(sol.maxTokens).toBe(128000)
  })

  test("PR8 的总 context 语义贯穿 Core 到 Pi 模型配置", () => {
    const glm = byID.get("glm-5.3")!
    expect(glm.contextWindow).toBe(200000)
    expect(glm.maxTokens).toBe(131072)
  })

  test("hy4-preview 通过 OpenRouter 能力 fallback 映射为可用 Pi 模型", () => {
    const discovered = buildModelSpecs({
      data: [{
        model_name: "hy4-preview",
        litellm_params: { model: "openai/hy4-preview" },
        model_info: {
          mode: "chat",
          input_cost_per_token: 0.000000834,
          output_cost_per_token: 0.000002501,
          cache_read_input_token_cost: 0.000000042,
        },
      }],
    }, {
      openrouter: {
        models: {
          "hy4-preview": {
            id: "hy4-preview",
            canonical_model_id: "tencent/hy4-preview",
            tool_call: true,
            reasoning: true,
            modalities: { input: ["text"], output: ["text"] },
            limit: { context: 1024000, output: 64000 },
          },
        },
      },
      opencode: {
        models: {
          "hy4-preview": {
            id: "hy4-preview",
            canonical_model_id: "tencent/hy4-preview",
            limit: { context: 1000000, output: 32000 },
          },
        },
      },
    }, { contextTierCap: true, protocolOverrides: {} })
    const mapped = toProviderModels(discovered, ROOT)[0]!
    expect(mapped.id).toBe("hy4-preview")
    expect(mapped.contextWindow).toBe(1024000)
    expect(mapped.maxTokens).toBe(64000)
    expect(mapped.contextWindow).toBeGreaterThan(0)
    expect(mapped.maxTokens).toBeGreaterThan(0)
    expect(mapped.cost.input).toBeCloseTo(0.834)
    expect(mapped.cost.output).toBeCloseTo(2.501)
  })

  test("id 与 display name 均为 model_name", () => {
    expect(byID.get("gpt-6-sol")?.name).toBe("gpt-6-sol")
  })
  test("非正数 operational limits 不会发布给 Pi，且不影响有效模型", () => {
    const valid = spec([])
    valid.id = "valid"
    valid.name = "valid"
    valid.limit = { context: 128000, input: 128000, output: 32000 }

    const zeroContext = spec([])
    zeroContext.id = "zero-context"
    zeroContext.name = "zero-context"
    zeroContext.limit = { context: 0, input: 0, output: 32000 }

    const zeroOutput = spec([])
    zeroOutput.id = "zero-output"
    zeroOutput.name = "zero-output"
    zeroOutput.limit = { context: 128000, input: 128000, output: 0 }

    const mapped = toProviderModels([zeroContext, valid, zeroOutput], ROOT)
    expect(mapped.map((model) => model.id)).toEqual(["valid"])
    expect(mapped[0]!.contextWindow).toBe(128000)
    expect(mapped[0]!.maxTokens).toBe(32000)
  })

})

describe("thinkingLevelMap", () => {
  test("effort 类映射同名档位并隐藏未声明项", () => {
    const map = thinkingLevelMapFor(
      spec([
        { id: "none", settings: { reasoningEffort: "none" } },
        { id: "low", settings: { reasoningEffort: "low" } },
        { id: "medium", settings: { reasoningEffort: "medium" } },
        { id: "high", settings: { reasoningEffort: "high" } },
        { id: "xhigh", settings: { reasoningEffort: "xhigh" } },
      ]),
    )!
    expect(map).toEqual({
      off: "none",
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: null,
    })
  })

  test("budget 类只提供 high/max 且未声明项为 null，off 不写键", () => {
    const withMax = thinkingLevelMapFor(
      spec(
        [
          { id: "high", settings: { thinking: { type: "enabled", budgetTokens: 16000 } } },
          { id: "max", settings: { thinking: { type: "enabled", budgetTokens: 64000 } } },
        ],
        "messages",
      ),
    )!
    expect(withMax).toEqual({
      minimal: null,
      low: null,
      medium: null,
      high: "high",
      xhigh: null,
      max: "max",
    })
    // `off` must be absent so the picker offers "thinking off" and the request path can
    // send `thinking: {type:"disabled"}` (host hides null levels).
    expect("off" in withMax).toBeFalse()

    const withoutMax = thinkingLevelMapFor(
      spec([{ id: "high", settings: { thinking: { type: "enabled", budgetTokens: 16000 } } }], "messages"),
    )!
    expect(withoutMax.max).toBeNull()
    expect(withoutMax.high).toBe("high")
    expect("off" in withoutMax).toBeFalse()
  })

  test("无档位时不给 thinkingLevelMap 且 reasoning 为 false", () => {
    expect(thinkingLevelMapFor(spec([]))).toBeUndefined()
    const noVariants = toProviderModels([spec([])], ROOT)[0]!
    expect(noVariants.reasoning).toBeFalse()
    expect("thinkingLevelMap" in noVariants).toBeFalse()
  })

  test("有档位时 reasoning 为 true", () => {
    const withVariants = toProviderModels([spec([{ id: "high", settings: {} }])], ROOT)[0]!
    expect(withVariants.reasoning).toBeTrue()
    expect(withVariants.thinkingLevelMap).toBeDefined()
  })

  test("fixtures 上的真实映射：responses effort 与 messages budget", () => {
    const sol = byID.get("gpt-6-sol")!
    expect(sol.reasoning).toBeTrue()
    expect(sol.thinkingLevelMap?.off).toBe("none")
    expect(sol.thinkingLevelMap?.low).toBe("low")
    expect(sol.thinkingLevelMap?.minimal).toBeNull()

    const claude = byID.get("claude-db")!
    expect(claude.reasoning).toBeTrue()
    expect(claude.thinkingLevelMap?.high).toBe("high")
    expect(claude.thinkingLevelMap?.max).toBe("max")
    expect(claude.thinkingLevelMap?.medium).toBeNull()
  })

  test("toggle 类模型不给档位", () => {
    const glm = byID.get("glm-5.3")!
    expect(glm.reasoning).toBeFalse()
    expect("thinkingLevelMap" in glm).toBeFalse()
  })
})
