import { describe, expect, test } from "bun:test"
import litellm from "./fixtures/litellm-model-info.json" with { type: "json" }
import modelsDev from "./fixtures/models-dev.json" with { type: "json" }
import { buildModelSpecs, hasOperationalLimits, type ModelSpec } from "../src/core/index.ts"
import { PUBLICATION_SCHEMA_VERSION } from "../src/core/index.ts"
import { PROTOCOL_API, thinkingLevelMapFor, toProviderModels } from "../src/extension/map.ts"

/** Core capability gate: serving-proof levels only exist on Core v8. */
const CORE_V8 = (PUBLICATION_SCHEMA_VERSION as number) === 8

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
  test("只映射具有 operational limits 的 spec", () => {
    const operational = specs.filter(hasOperationalLimits)
    expect(models).toHaveLength(operational.length)
    expect(models.map((model) => model.id)).toEqual(operational.map((spec) => spec.id))
    expect(specs.some((spec) => !hasOperationalLimits(spec))).toBeTrue()
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
    // Dedicated aligned fixture: LiteLLM declarations equal the registry
    // values, so old Core (LiteLLM-only) and new Core (canonical) agree.
    const doc = {
      models: {
        "labA/mimo": {
          limit: { context: 100000, output: 10000 },
          modalities: { input: ["text", "image"], output: ["text"] },
          tool_call: true,
          reasoning: false,
        },
      },
      providers: {},
    }
    const input = {
      data: [{
        model_name: "mimo",
        litellm_params: { model: "mimo" },
        model_info: {
          mode: "chat",
          max_input_tokens: 100000,
          max_output_tokens: 10000,
          supports_function_calling: true,
          supports_reasoning: false,
          supports_vision: true,
          supports_pdf_input: false,
          supports_audio_input: false,
          supports_video_input: false,
          supports_audio_output: false,
        },
      }],
    }
    const mapped = toProviderModels(buildModelSpecs(input, doc, { contextTierCap: true, protocolOverrides: {} }), ROOT)[0]!
    expect(mapped.input).toEqual(["text", "image"])
  })

  test("cost 与上限来自发现结果", () => {
    const doc = {
      models: {
        "labA/sol": {
          limit: { context: 272000, output: 128000 },
          modalities: { input: ["text"], output: ["text"] },
          tool_call: true,
          reasoning: true,
        },
      },
      providers: {},
    }
    const input = {
      data: [{
        model_name: "sol",
        litellm_params: { model: "sol" },
        model_info: {
          mode: "responses",
          max_input_tokens: 272000,
          max_output_tokens: 128000,
          supports_function_calling: true,
          supports_reasoning: true,
          supports_vision: false,
          supports_pdf_input: false,
          supports_audio_input: false,
          supports_video_input: false,
          supports_audio_output: false,
          input_cost_per_token: 0.000002,
          output_cost_per_token: 0.00001,
        },
      }],
    }
    const sol = toProviderModels(buildModelSpecs(input, doc, { contextTierCap: false, protocolOverrides: {} }), ROOT)[0]!
    expect(sol.cost.input).toBe(2)
    expect(sol.cost.output).toBe(10)
    expect(sol.contextWindow).toBe(272000)
    expect(sol.maxTokens).toBe(128000)
  })

  test("PR8 的总 context 语义贯穿 Core 到 Pi 模型配置", () => {
    const doc = {
      models: {
        "labA/glm": {
          limit: { context: 200000, input: 200000, output: 32000 },
          modalities: { input: ["text"], output: ["text"] },
          tool_call: true,
          reasoning: false,
        },
      },
      providers: {},
    }
    const input = {
      data: [{
        model_name: "glm",
        litellm_params: { model: "glm" },
        model_info: {
          mode: "chat",
          max_input_tokens: 200000,
          max_output_tokens: 32000,
          supports_function_calling: true,
          supports_reasoning: false,
          supports_vision: false,
          supports_pdf_input: false,
          supports_audio_input: false,
          supports_video_input: false,
          supports_audio_output: false,
        },
      }],
    }
    const glm = toProviderModels(buildModelSpecs(input, doc, { contextTierCap: false, protocolOverrides: {} }), ROOT)[0]!
    expect(glm.contextWindow).toBe(200000)
    // models.dev is authoritative for intrinsic limits; the LiteLLM
    // descriptive 131072 is retained as a resolved discrepancy.
    expect(glm.maxTokens).toBe(32000)
  })

  test("hy4-preview 通过 canonical registry 映射为可用 Pi 模型（reseller 记录仅诊断）", () => {
    const discovered = buildModelSpecs({
      data: [{
        model_name: "hy4-preview",
        litellm_params: { model: "hy4-preview" },
        model_info: {
          mode: "chat",
          max_input_tokens: 1024000,
          max_output_tokens: 64000,
          supports_function_calling: true,
          supports_reasoning: true,
          supports_vision: false,
          supports_pdf_input: false,
          supports_audio_input: false,
          supports_video_input: false,
          supports_audio_output: false,
          input_cost_per_token: 0.000000834,
          output_cost_per_token: 0.000002501,
          cache_read_input_token_cost: 0.000000042,
        },
      }],
    }, {
      models: {
        "tencent/hy4-preview": {
          limit: { context: 1024000, input: 1024000, output: 64000 },
          modalities: { input: ["text"], output: ["text"] },
          tool_call: true,
          reasoning: true,
        },
      },
      providers: {
        openrouter: {
          models: {
            "hy4-preview": {
              id: "hy4-preview",
              canonical_model_id: "tencent/hy4-preview",
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
      },
    }, { contextTierCap: true, protocolOverrides: {} })
    // Unproven reseller records supply nothing (D5): canonical limits plus
    // operator-declared LiteLLM prices reach the host mapping.
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

  test("通用 operational-limit guard 不发布 context/output 非正数模型", () => {
    const invalidContext = spec([])
    invalidContext.id = "zero-context"
    invalidContext.name = "zero-context"
    invalidContext.limit = { context: 0, input: 0, output: 100 }

    const invalidOutput = spec([])
    invalidOutput.id = "zero-output"
    invalidOutput.name = "zero-output"
    invalidOutput.limit = { context: 1000, input: 1000, output: 0 }

    const valid = spec([])
    valid.id = "valid"
    valid.name = "valid"

    expect(hasOperationalLimits(invalidContext)).toBeFalse()
    expect(hasOperationalLimits(invalidOutput)).toBeFalse()
    expect(hasOperationalLimits(valid)).toBeTrue()

    const mapped = toProviderModels([invalidContext, invalidOutput, valid], ROOT)
    expect(mapped.map((model) => model.id)).toEqual(["valid"])
    expect(mapped[0]!.contextWindow).toBeGreaterThan(0)
    expect(mapped[0]!.maxTokens).toBeGreaterThan(0)
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

  test.skipIf(!CORE_V8)("fixtures 上的真实映射：proven serving 的 effort 与 budget 档位", () => {
    // Serving-proof levels only exist on Core v8: the deployment declares
    // labA and hits the serving record exactly.
    const effortDoc = {
      models: {
        "labA/sol": {
          limit: { context: 100000, output: 10000 },
          modalities: { input: ["text"], output: ["text"] },
          tool_call: true,
          reasoning: true,
        },
      },
      providers: {
        labA: {
          models: {
            sol: {
              id: "sol",
              limit: { context: 100000, output: 10000 },
              modalities: { input: ["text"], output: ["text"] },
              tool_call: true,
              reasoning: true,
              reasoning_options: [{ type: "effort", values: ["none", "low", "high"] }],
            },
          },
        },
      },
    }
    const effortBody = {
      data: [{
        model_name: "sol",
        litellm_params: { model: "sol" },
        model_info: {
          mode: "responses",
          models_dev_provider: "labA",
          max_input_tokens: 100000,
          max_output_tokens: 10000,
          supports_function_calling: true,
          supports_reasoning: true,
          supports_vision: false,
          supports_pdf_input: false,
          supports_audio_input: false,
          supports_video_input: false,
          supports_audio_output: false,
        },
      }],
    }
    const solSpecs = buildModelSpecs(effortBody, effortDoc, { contextTierCap: false, protocolOverrides: {} })
    const sol = toProviderModels(solSpecs, ROOT)[0]!
    expect(sol.reasoning).toBeTrue()
    expect(sol.thinkingLevelMap?.low).toBe("low")
    expect(sol.thinkingLevelMap?.max).toBeNull()
  })

  test.skipIf(!CORE_V8)("toggle 类模型支持 reasoning 但不给档位（levels known-empty）", () => {
    const toggleDoc = {
      models: {
        "labA/glm": {
          limit: { context: 100000, output: 10000 },
          modalities: { input: ["text"], output: ["text"] },
          tool_call: true,
          reasoning: true,
        },
      },
      providers: {
        labA: {
          models: {
            glm: {
              id: "glm",
              limit: { context: 100000, output: 10000 },
              modalities: { input: ["text"], output: ["text"] },
              tool_call: true,
              reasoning: true,
              reasoning_options: [{ type: "toggle" }],
            },
          },
        },
      },
    }
    const toggleBody = {
      data: [{
        model_name: "glm",
        litellm_params: { model: "glm" },
        model_info: {
          mode: "chat",
          models_dev_provider: "labA",
          max_input_tokens: 100000,
          max_output_tokens: 10000,
          supports_function_calling: true,
          supports_reasoning: true,
          supports_vision: false,
          supports_pdf_input: false,
          supports_audio_input: false,
          supports_video_input: false,
          supports_audio_output: false,
        },
      }],
    }
    const glmSpecs = buildModelSpecs(toggleBody, toggleDoc, { contextTierCap: false, protocolOverrides: {} })
    const glm = toProviderModels(glmSpecs, ROOT)[0]!
    expect(glm.reasoning).toBeTrue()
    expect("thinkingLevelMap" in glm).toBeFalse()
  })
})
