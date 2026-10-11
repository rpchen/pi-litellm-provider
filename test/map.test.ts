import { describe, expect, test } from "bun:test"
import type { ModelSpec } from "../src/core/index.ts"
import { PROTOCOL_API, thinkingLevelMapFor, toProviderModels } from "../src/extension/map.ts"
const ROOT = "http://litellm.example:4000"
function spec(variants: ModelSpec["variants"] = [], protocol: ModelSpec["protocol"] = "chat"): ModelSpec {
  return { id: "m", name: "m", protocol, reasoningSupported: "supported", capabilities: { tools: true, input: ["text"], output: ["text"] }, variants,
    released: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, limit: { context: 1000, input: 1000, output: 100 } }
}
describe("protocol -> pi-ai api mapping", () => {
  test("maps every LiteLLM protocol to a pi-ai API id", () => {
    expect(PROTOCOL_API).toEqual({ chat: "openai-completions", responses: "openai-responses", messages: "anthropic-messages" })
  })
})
describe("toProviderModels", () => {
  test("api 按协议逐模型设置；messages 模型用根地址，chat/responses 用 /v1 地址", () => {
    for (const protocol of ["chat", "responses", "messages"] as const) {
      const model = toProviderModels([spec([], protocol)], ROOT)[0]!
      expect(model.api).toBe(PROTOCOL_API[protocol])
      expect(model.baseUrl).toBe(protocol === "messages" ? ROOT : `${ROOT}/v1`)
    }
  })
  test("input 只保留已知 text/image，不补 text", () => {
    const model = spec()
    model.capabilities = { tools: true, input: ["image", "pdf", "audio"], output: ["text"] }
    expect(toProviderModels([model], ROOT)[0]!.input).toEqual(["image"])
  })
  test("cost 与上限完整透传 Core，不按价格截断", () => {
    const model = spec()
    model.limit = { context: 1050000, input: 1050000, output: 128000 }
    model.cost = { input: 2, output: 10, cacheRead: 0, cacheWrite: 0 }
    expect(toProviderModels([model], ROOT)[0]).toMatchObject({ contextWindow: 1050000, maxTokens: 128000, cost: model.cost })
  })
  test("通用 operational-limit guard 不发布 context/output 非正数或非有限模型", () => {
    for (const value of [0, -1, NaN, Infinity]) for (const field of ["context", "output"] as const) {
      const model = spec()
      model.limit = { ...model.limit, [field]: value }
      expect(toProviderModels([model], ROOT)).toEqual([])
    }
    expect(toProviderModels([spec()], ROOT)).toHaveLength(1)
  })
})
describe("thinkingLevelMap", () => {
  test("effort 类映射同名档位并隐藏未声明档位", () => {
    expect(thinkingLevelMapFor(spec([{ id: "none", settings: {} }, { id: "high", settings: {} }]))).toEqual({ off: "none", minimal: null, low: null, medium: null, high: "high", xhigh: null, max: null })
  })
  test("budget 类保留 high/max 及 off 兼容控制，不推导新预算", () => {
    const model = spec([{ id: "high", settings: { thinking: { type: "enabled", budgetTokens: 16000 } } }, { id: "max", settings: { thinking: { type: "enabled", budgetTokens: 64000 } } }], "messages")
    const map = thinkingLevelMapFor(model)!
    expect(map).toEqual({ minimal: null, low: null, medium: null, high: "high", xhigh: null, max: "max" })
    expect("off" in map).toBeFalse()
    expect(thinkingLevelMapFor(spec([model.variants[0]!], "messages"))!.max).toBeNull()
  })
  test("无档位保持 reasoning=true，所有额外档位显式 null", () => {
    const model = toProviderModels([spec()], ROOT)[0]!
    expect(model.reasoning).toBeTrue()
    expect(model.thinkingLevelMap).toEqual({ off: null, minimal: null, low: null, medium: null, high: null, xhigh: null, max: null })
  })
})
