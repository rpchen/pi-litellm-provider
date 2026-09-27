import { describe, expect, test } from "bun:test"
import litellm from "./fixtures/litellm-model-info.json" with { type: "json" }
import modelsDev from "./fixtures/models-dev.json" with { type: "json" }
import { buildModelSpecs, modelFingerprint } from "../src/core/index.ts"

const options = { contextTierCap: true, protocolOverrides: {} }

describe("buildModelSpecs", () => {
  test("输出与 fixtures 的完整快照一致", () => {
    expect(buildModelSpecs(litellm, modelsDev, options)).toMatchSnapshot()
  })

  test("稳定排序：按 id 的 en 顺序", () => {
    const specs = buildModelSpecs(litellm, modelsDev, options)
    const ids = specs.map((spec) => spec.id)
    expect(ids).toEqual([...ids].sort((left, right) => left.localeCompare(right, "en")))
  })

  test("协议覆盖影响 spec.protocol 与档位生成", () => {
    const overridden = buildModelSpecs(litellm, modelsDev, {
      ...options,
      protocolOverrides: { "claude-sonnet-4-5-route": "chat" },
    })
    const gpt = buildModelSpecs(litellm, modelsDev, options).find((spec) => spec.id === "gpt-6-sol")!
    expect(gpt.protocol).toBe("responses")

    // Without the override, messages-style budget variants are produced for a Messages model.
    const messagesSpec = buildModelSpecs(
      { data: [{ model_name: "claude-x", litellm_params: { model: "anthropic/claude-sonnet-4-5" }, model_info: { mode: "chat" } }] },
      modelsDev,
      options,
    )[0]!
    expect(messagesSpec.protocol).toBe("messages")
    expect(messagesSpec.variants.map((variant) => variant.id)).toEqual(["high", "max"])

    const chatSpec = buildModelSpecs(
      { data: [{ model_name: "claude-x", litellm_params: { model: "anthropic/claude-sonnet-4-5" }, model_info: { mode: "chat" } }] },
      modelsDev,
      { ...options, protocolOverrides: { "claude-x": "chat" } },
    )[0]!
    expect(chatSpec.protocol).toBe("chat")
    expect(chatSpec.variants).toEqual([])
    expect(overridden).toBeDefined()
  })

  test("contextTierCap 关闭时保留原上限", () => {
    const capped = buildModelSpecs(litellm, modelsDev, options).find((spec) => spec.id === "gpt-6-sol")!
    const uncapped = buildModelSpecs(litellm, modelsDev, { ...options, contextTierCap: false }).find(
      (spec) => spec.id === "gpt-6-sol",
    )!
    expect(capped.limit.context).toBe(272000)
    expect(uncapped.limit.context).toBe(922000)
  })

  test("releaseUnit 区分字符串日期、数值与缺失", () => {
    const specs = buildModelSpecs(litellm, modelsDev, options)
    const byID = new Map(specs.map((spec) => [spec.id, spec]))
    // No models.dev record → none
    expect(byID.get("deepseek-v4-flash")?.releaseUnit).toBe("none")
    // String release_date → parsed Unix ms
    expect(byID.get("gpt-6-sol")?.releaseUnit).toBe("unix-ms")
    expect(byID.get("gpt-6-sol")?.released).toBe(Date.parse("2026-05-01"))

    // Numeric release_date is passed through and marked unit-unknown
    const numeric = buildModelSpecs(
      {
        data: [
          {
            model_name: "gpt-numeric",
            litellm_params: { model: "openai/gpt-numeric" },
            model_info: { mode: "chat" },
          },
        ],
      },
      { openai: { models: { "gpt-numeric": { id: "gpt-numeric", release_date: 1700000000000 } } } },
      options,
    )[0]!
    expect(numeric.releaseUnit).toBe("unknown")
    expect(numeric.released).toBe(1700000000000)
  })

  test("成功空响应产生空清单", () => {
    expect(buildModelSpecs({ data: [] }, modelsDev, options)).toEqual([])
  })
})

describe("modelFingerprint", () => {
  test("同输入同指纹", () => {
    const first = buildModelSpecs(litellm, modelsDev, options)
    const second = buildModelSpecs(litellm, modelsDev, options)
    expect(modelFingerprint(first)).toBe(modelFingerprint(second))
  })

  test("任一字段变化指纹变化", () => {
    const specs = buildModelSpecs(litellm, modelsDev, options)
    const changed = specs.map((spec, index) =>
      index === 0 ? { ...spec, limit: { ...spec.limit, context: spec.limit.context + 1 } } : spec,
    )
    expect(modelFingerprint(specs)).not.toBe(modelFingerprint(changed))
  })

  test("键顺序不影响指纹", () => {
    const specs = buildModelSpecs(litellm, modelsDev, options)
    const shuffled = specs.map((spec) => {
      const reordered = Object.fromEntries(Object.entries(spec).reverse()) as typeof spec
      return reordered
    })
    expect(modelFingerprint(shuffled)).toBe(modelFingerprint(specs))
  })
})
