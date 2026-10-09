import { describe, expect, test } from "bun:test"
import litellmFixture from "./fixtures/litellm-model-info.json" with { type: "json" }
import modelsDevFixture from "./fixtures/models-dev.json" with { type: "json" }
import catalogShapeFixture from "./fixtures/models-dev-catalog-shape.json" with { type: "json" }

const FORBIDDEN_KEYS = new Set([
  "api_base",
  "litellm_credential_name",
  "tags",
  "access_via_team_ids",
  "access_groups",
  "id",
  "api_key",
])

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys)
  } else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      keys.add(key)
      collectKeys(item, keys)
    }
  }
  return keys
}

describe("fixtures", () => {
  test("LiteLLM 样本不含敏感字段或 Key", () => {
    const keys = collectKeys(litellmFixture)
    for (const forbidden of FORBIDDEN_KEYS) expect(keys.has(forbidden)).toBeFalse()
    expect(JSON.stringify(litellmFixture)).not.toMatch(/sk-[A-Za-z0-9_-]{8,}/)
  })

  test("LiteLLM 样本不含真实内网地址", () => {
    const text = JSON.stringify(litellmFixture)
    const urls = text.match(/https?:\/\/[^"\\]+/g) ?? []
    for (const url of urls) {
      expect(url.startsWith("http://litellm.example:4000")).toBeTrue()
    }
  })

  test("LiteLLM 样本覆盖关键部署场景", () => {
    const data = litellmFixture.data as Array<{ model_name?: string; model_info?: Record<string, unknown> }>
    const modes = new Set(data.map((item) => item.model_info?.mode).filter(Boolean))
    expect(modes.has("chat")).toBeTrue()
    expect(modes.has("responses")).toBeTrue()
    expect(modes.has("embedding")).toBeTrue()
    expect(modes.has("image_generation")).toBeTrue()

    const text = JSON.stringify(data)
    expect(text).toContain("above_272k_tokens")
    expect(text).toContain("above_512k_tokens")
    expect(text).toContain("tiered_pricing")
    expect(text).toContain("supported_endpoints")

    // Anthropic upstreams (Messages routing)
    expect(data.some((item) => item.model_name === "claude-db")).toBeTrue()
    expect(data.some((item) => item.model_name === "claude-bedrock")).toBeTrue()

    // Multi-deployment divergence and invalid data
    expect(data.filter((item) => item.model_name === "shared-route").length).toBe(2)
    expect(data.some((item) => item.model_name === "invalid-fields")).toBeTrue()
    // Deployment missing model_name must survive into the fixture
    expect(data.some((item) => item.model_name === undefined)).toBeTrue()
    // mode-less image model excluded by name
    expect(data.some((item) => item.model_name === "dall-e-3")).toBeTrue()
  })

  test("catalog 形状样本含 registry 与 serving 四态且无敏感信息", () => {
    const text = JSON.stringify(catalogShapeFixture)
    expect(text).not.toMatch(/sk-[A-Za-z0-9_-]{8,}/)
    const doc = catalogShapeFixture as { models: Record<string, unknown>; providers: Record<string, { models: Record<string, any> }> }
    // canonical + declared-serving + relation-only + LiteLLM-only 覆盖
    expect(Object.keys(doc.models)).toEqual(["labA/alpha", "labB/beta"])
    expect(doc.providers.labA!.models.alpha.reasoning_options[0]?.type).toBe("effort")
    expect(doc.providers.gatewayX!.models["beta-free"].canonical_model_id).toBe("labB/beta")
  })

  test("models.dev 样本可加载且覆盖记录选择与档位来源", () => {
    const fixture = modelsDevFixture as {
      models: Record<string, any>
      providers: Record<string, { models: Record<string, any> }>
    }
    expect(fixture.providers.openai!.models["gpt-5.5"]!.reasoning_options[0]?.type).toBe("effort")
    expect(fixture.providers.anthropic!.models["claude-sonnet-4-5"]!.reasoning_options[0]?.max).toBe(64000)
    expect(fixture.providers.anthropic!.models["claude-opus-4-1"]!.reasoning_options[0]).toEqual({ type: "budget_tokens" })
    expect(fixture.providers.zai!.models["glm-5.3"]!.reasoning_options[0]?.type).toBe("toggle")
    expect(fixture.providers.minimax!.models["MiniMax-M3"]!.id).toBe("MiniMax-M3")
    expect(fixture.providers["reseller-a"]!.models["shared-model"]).toBeDefined()
    expect(fixture.providers["reseller-b"]!.models["shared-model"]).toBeDefined()
  })
})
