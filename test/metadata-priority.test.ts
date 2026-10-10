import { describe, expect, test } from "bun:test"
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai"
import discovery from "./fixtures/metadata-priority/synthetic-discovery.json" with { type: "json" }
import catalog from "./fixtures/metadata-priority/modelsdev-subset.json" with { type: "json" }
import oracle from "./fixtures/metadata-priority/expected-16.json" with { type: "json" }
import { buildPublicationResult, createLastKnownGoodStore, createDiscoverySnapshot, endpointFingerprint, type ModelSpec } from "../src/core/index.ts"
import { toProviderModelsWithPublication, toProviderModels, reasoningForHost } from "../src/extension/map.ts"
import { discoverModels, refreshProviderModels } from "../src/extension/discovery.ts"
import { createProviderDiagnosticsState, formatProviderDiagnostics } from "../src/extension/diagnostics.ts"
import { createAuditReport } from "../src/extension/audit.ts"

const ROOT = "http://litellm.example:4000"
const options = { contextTierCap: true, protocolOverrides: {} }
const result = buildPublicationResult(discovery, catalog, options)
const models = toProviderModelsWithPublication(result.publishable, ROOT)
const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const
const config = { baseUrl: ROOT, contextTierCap: true, protocolOverrides: {}, pollInterval: 300, globalConfigPath: "unused", projectConfigPath: "unused" }

describe("restore-model-metadata-priority Pi [T01 T13 T28 T30]", () => {
  test("all 16 publish and no model is silently omitted", () => {
    expect(result.blocked).toEqual([])
    expect(models.map((model) => model.id)).toEqual(oracle.models.map((model) => model.id))
  })
  for (const expected of oracle.models) {
    test(`${expected.id}: exact final host limits, capabilities, cost and selectable levels`, () => {
      const model = models.find((item) => item.id === expected.id)!
      expect(model.name).toBe(expected.id)
      expect(model.api).toBe(expected.protocol === "responses" ? "openai-responses" : "openai-completions")
      expect(model.contextWindow).toBe(expected.limit.context)
      expect(model.maxTokens).toBe(expected.limit.output)
      expect(model.input).toEqual(expected.input.filter((value) => value === "text" || value === "image"))
      expect(model.reasoning).toBe(expected.reasoningSupported === "supported")
      const prices = expected.cost
      expect(model.cost).toEqual({ input: prices.input ?? 0, output: prices.output ?? 0, cacheRead: prices.cache_read ?? 0, cacheWrite: prices.cache_write ?? 0 })
      expect(getSupportedThinkingLevels({ ...model, baseUrl: model.baseUrl ?? ROOT, provider: "litellm", api: "openai-completions" }).map(String)).toEqual(expected.piLevels)
      for (const level of levels) expect(model.thinkingLevelMap?.[level]).toBe(expected.piLevels.includes(level) ? (level === "off" ? "none" : level) : null)
    })
  }
  test("[T14 T24] supported-empty and unsupported stay distinct; missing verdict never infers from variants", () => {
    const base = result.publishable[0]!.spec
    const supported: ModelSpec = { ...base, variants: [], reasoningSupported: "supported" }
    const unsupported: ModelSpec = { ...base, variants: [], reasoningSupported: "unsupported" }
    const unknown = { ...base, reasoningSupported: undefined }
    const [yes, no] = toProviderModels([supported, unsupported], ROOT)
    expect(yes!.reasoning).toBeTrue()
    expect(Object.values(yes!.thinkingLevelMap!)).toEqual(levels.map(() => null))
    expect(no!.reasoning).toBeFalse()
    expect(reasoningForHost(unknown)).toBeFalse()
    expect(toProviderModels([{ ...base, capabilities: { ...base.capabilities, input: ["image", "audio"] } }], ROOT)[0]!.input).toEqual(["image"])
  })
})

describe("Pi selected metadata and recovery [T16 T17 T18 T20 T22 T23 T31]", () => {
  const fetchImpl = async () => new Response(JSON.stringify(discovery), { status: 200 })
  test("bad/zero/missing prices and the old tier option never alter availability, limits or levels", async () => {
    const badPrices = structuredClone(catalog)
    for (const provider of Object.values(badPrices.providers)) for (const record of Object.values(provider.models)) Object.assign(record, { cost: { input: -1, output: "bad" } })
    const normal = await discoverModels(config, "sk-test", undefined, { fetchImpl, loadModelsDevCatalog: async () => catalog })
    const changed = await discoverModels({ ...config, contextTierCap: false }, "sk-test", undefined, { fetchImpl, loadModelsDevCatalog: async () => badPrices })
    expect(changed.models.map(({ cost, ...model }) => model)).toEqual(normal.models.map(({ cost, ...model }) => model))
    expect(changed.models.every((model) => Object.values(model.cost).every((value) => value === 0))).toBeTrue()
    expect(changed.catalog.regressions).toEqual([])
  })
  test("catalog outage retains the same model_name configuration across internal route/deployment changes; deletion removes it", async () => {
    const store = createLastKnownGoodStore()
    const first = await discoverModels(config, "sk-test", undefined, { fetchImpl, loadModelsDevCatalog: async () => catalog, publication: { store } })
    const changed = structuredClone(discovery)
    for (const entry of changed.data) Object.assign(entry, { litellm_params: { model: "private/changed", base_model: "different-version" } })
    const second = await discoverModels(config, "sk-test", undefined, { fetchImpl: async () => new Response(JSON.stringify(changed)), loadModelsDevCatalog: async () => { throw new Error("catalog outage") }, publication: { store } })
    expect(second.models).toEqual(first.models)
    expect(second.publication.lkgIDs).toHaveLength(16)
    const state = createProviderDiagnosticsState()
    state.current = { status: "ready", modelCount: 16, models: second.models, discovery: second.diagnostics, publication: second.publication }
    expect(formatProviderDiagnostics(state)).toContain("deepseek-v4.1-flash · configured-lkg · 来源 前次配置 · 推理 low,high,max")
    const removed = await discoverModels(config, "sk-test", undefined, { fetchImpl: async () => new Response('{"data":[]}'), loadModelsDevCatalog: async () => catalog, publication: { store } })
    expect(removed.models).toEqual([])
  })
  test("diagnostics and audit report actual metadata and registered levels without raw input", async () => {
    const input = structuredClone(discovery)
    Object.assign(input.data[0]!, { litellm_params: { api_key: "sk-injected-audit-secret", api_base: "http://private.invalid", model: "private/secret-route" } })
    const outcome = await discoverModels(config, "sk-test", undefined, { fetchImpl: async () => new Response(JSON.stringify(input)), loadModelsDevCatalog: async () => catalog })
    const state = createProviderDiagnosticsState()
    state.current = { status: "ready", modelCount: 16, models: outcome.models, discovery: outcome.diagnostics, publication: outcome.publication }
    const text = formatProviderDiagnostics(state)
    expect(text).toContain("命中 16/16")
    expect(text).toContain("来源 deepseek · 推理 low,high,max")
    expect(text).not.toMatch(/serving|proof|models_dev_provider|候选声明/)
    const report = JSON.stringify(createAuditReport([{ id: "default", providerId: "litellm", status: "ready", models: outcome.models, discovery: outcome.diagnostics }]))
    expect(report).toContain('"recordKey":"deepseek-flash"')
    expect(report).toContain('"canonicalID":"deepseek/deepseek-v4.1-flash"')
    for (const output of [text, report]) for (const secret of ["sk-injected-audit-secret", "http://private.invalid", "private/secret-route"]) expect(output).not.toContain(secret)
  })
})

describe("Pi schema2 restore-only [T19 T21 T32]", () => {
  const snapshot = () => createDiscoverySnapshot(endpointFingerprint({ baseUrl: ROOT, credentialKey: "sk-test", buildOptions: options }), result.publishable.map((entry) => entry.spec))
  const restore = async (value: unknown, overrides = {}) => refreshProviderModels({ ...config, ...overrides }, {
    allowNetwork: false, credential: { key: "sk-test" }, stored: { models, snapshot: value },
  }, { fetchImpl: async () => { throw new Error("restore-only must not fetch") }, logger: { warn() {}, error() {} } })
  test("bad prices become zero; tier option changes preserve endpoint scope", async () => {
    const saved = snapshot()
    for (const model of saved.models) Object.assign(model.cost, { input: -1, output: "bad", cacheRead: NaN, cacheWrite: Infinity })
    const restored = await restore(saved, { contextTierCap: false })
    expect(restored).toHaveLength(16)
    expect(restored.map(({ cost, ...model }) => model)).toEqual(models.map(({ cost, ...model }) => model))
    expect(restored.every((model) => Object.values(model.cost).every((value) => value === 0))).toBeTrue()
  })
  test("old policy, corrupt critical configuration and a different protocol scope are rejected", async () => {
    expect(await restore({ ...snapshot(), schemaVersion: 1 })).toEqual([])
    const corrupt = snapshot()
    corrupt.models[0]!.limit.context += 1
    expect(await restore(corrupt)).toEqual([])
    expect(await restore(snapshot(), { protocolOverrides: { "deepseek-v4-pro": "responses" } })).toEqual([])
  })
})

for (const provider of ["opencode", "openrouter"] as const) {
  test(`[T03 T28] official absent: selected ${provider} record maps unchanged`, () => {
    const subset = structuredClone(catalog);
    for (const id of Object.keys(subset.providers)) if (id !== provider) delete (subset.providers as Record<string, unknown>)[id];
    const input = { data: discovery.data.filter((entry) => entry.model_name === "glm-5.3") };
    const configured = buildPublicationResult(input, subset, options);
    expect(configured.blocked).toEqual([]);
    const entry = configured.publishable[0]!;
    expect(entry.assessment.metadataSource?.providerID).toBe(provider);
    const mapped = toProviderModelsWithPublication(configured.publishable, ROOT)[0]!;
    expect(mapped.id).toBe("glm-5.3");
    expect(mapped.contextWindow).toBe(entry.spec.limit.context);
    expect(mapped.maxTokens).toBe(entry.spec.limit.output);
    expect(mapped.cost.input).toBe(entry.spec.cost.input);
  });
}
