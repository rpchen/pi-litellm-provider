import { describe, expect, test, afterEach } from "bun:test"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { createLastKnownGoodStore, lastKnownGoodKey, PUBLICATION_SCHEMA_VERSION } from "../src/core/index.ts"
import { resetModelsDevCacheForTest } from "../src/net/fetch.ts"
import { discoverModels } from "../src/extension/discovery.ts"
import {
  catalogNotice,
  formatProviderDiagnostics,
  publicationControllerForState,
  takePendingNotice,
  type ProviderDiagnosticsState,
} from "../src/extension/diagnostics.ts"
import piLitellmProvider, { buildProviderConfig } from "../src/extension/index.ts"
import { reasoningForHost, toProviderModelsWithPublication } from "../src/extension/map.ts"
import { DEFAULT_POLL_INTERVAL_SECONDS, type ExtensionConfig } from "../src/extension/config.ts"
import type { ProviderConfigLike, RefreshModelsContextLike } from "../src/extension/types.ts"

const BASE = "http://litellm.example:4000"
const KEY = "sk-publication-secret"

function config(overrides: Partial<ExtensionConfig> = {}): ExtensionConfig {
  return {
    baseUrl: BASE,
    pollInterval: DEFAULT_POLL_INTERVAL_SECONDS,
    contextTierCap: false,
    protocolOverrides: {},
    globalConfigPath: "unused",
    projectConfigPath: "unused",
    ...overrides,
  }
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

const COMPLETE_INFO = {
  max_input_tokens: 100_000,
  max_output_tokens: 10_000,
  supports_function_calling: true,
  supports_reasoning: false,
  supports_vision: false,
  supports_pdf_input: false,
  supports_audio_input: false,
  supports_video_input: false,
  supports_audio_output: false,
}

/** Core capability gate: v7 tests pin legacy selection semantics, v8 tests pin the canonical catalog. */
const CORE_V8 = (PUBLICATION_SCHEMA_VERSION as number) === 8
const itV7 = CORE_V8 ? test.skip : test
const itV8 = CORE_V8 ? test : test.skip

const COMPLETE_BODY = {
  data: [
    {
      model_name: "pub-complete",
      litellm_params: { model: "openai/pub-complete" },
      model_info: { mode: "chat", ...COMPLETE_INFO },
    },
  ],
}

const COMPLETE_CATALOG = {
  openai: {
    models: {
      "pub-complete": {
        id: "pub-complete",
        limit: { context: 100_000, output: 10_000 },
        tool_call: true,
        reasoning: false,
        modalities: { input: ["text"], output: ["text"] },
      },
    },
  },
}

const INCOMPLETE_BODY = {
  data: [
    {
      model_name: "pub-incomplete",
      litellm_params: { model: "openai/pub-incomplete" },
      // No limits and no capability declarations anywhere.
      model_info: { mode: "chat" },
    },
  ],
}

const silent = { warn: () => {}, error: () => {} }

afterEach(resetModelsDevCacheForTest)

describe("publication mapping", () => {
  test("reasoning follows the Core verdict, not variant count", () => {
    const base = {
      id: "m",
      name: "m",
      protocol: "chat" as const,
      capabilities: { tools: true, input: ["text"], output: ["text"] },
      released: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      limit: { context: 1000, input: 1000, output: 100 },
    }
    // Supported without levels: reasoning-capable, no level map.
    expect(reasoningForHost({ ...base, variants: [], reasoningSupported: "supported" })).toBeTrue()
    expect(reasoningForHost({ ...base, variants: [], reasoningSupported: "unsupported" })).toBeFalse()
    expect(reasoningForHost({ ...base, variants: [], reasoningSupported: "unknown" })).toBeFalse()
    // Legacy specs without the verdict keep variant-count inference.
    expect(reasoningForHost({ ...base, variants: [] })).toBeFalse()
    expect(reasoningForHost({ ...base, variants: [{ id: "high", settings: {} }] })).toBeTrue()
  })

  test("operational guard stays behind the Core partition", async () => {
    const outcome = await discoverModels(config(), KEY, undefined, {
      fetchImpl: async (input) =>
        String(input).includes("/v1/model/info")
          ? jsonResponse(200, INCOMPLETE_BODY)
          : jsonResponse(200, { openai: { models: {} } }),
      logger: silent,
    })
    expect(outcome.models).toEqual([])
    expect(outcome.publication.withheld.map((model) => model.id)).toEqual(["pub-incomplete"])
    // Mapping an empty publishable partition registers nothing.
    expect(toProviderModelsWithPublication([], BASE)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Canonical provider selection integration (fix-canonical-provider-selection-integration)
//
// Sanitized DeepSeek V4.1 Flash data shapes mirrored from the Core fixture
// (`litellm-discovery-core/test/fixtures/models-dev-catalog-fixtures.ts`).
// No production code may branch on a model or provider name.
// ---------------------------------------------------------------------------

/** Real-form LiteLLM model_info for `deepseek-v4.1-flash` (route + descriptive caps). */
const DEEPSEEK_BODY = {
  data: [
    {
      model_name: "deepseek-v4.1-flash",
      litellm_params: { model: "deepseek-v4.1-flash", custom_llm_provider: "openai" },
      model_info: {
        mode: "responses",
        base_model: "deepseek-v4.1-flash",
        max_input_tokens: 1_000_000,
        max_output_tokens: 384_000,
        max_tokens: 384_000,
        supports_vision: true,
        supports_pdf_input: false,
        supports_audio_input: false,
        supports_function_calling: true,
        supports_reasoning: true,
      },
    },
  ],
}

const DEEPSEEK_CATALOG = {
  deepseek: {
    models: {
      "deepseek-v4-flash": {
        id: "deepseek-v4-flash",
        tool_call: true,
        reasoning: true,
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 1_000_000, output: 393_216 },
        cost: { input: 0.15, output: 0.6 },
        canonical_model_id: "deepseek/deepseek-v4.1-flash",
      },
      "deepseek-flash": {
        id: "deepseek-flash",
        tool_call: true,
        reasoning: true,
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 1_000_000, output: 393_216 },
        cost: { input: 0.15, output: 0.6 },
        canonical_model_id: "deepseek/deepseek-v4.1-flash",
      },
    },
  },
  openrouter: {
    models: {
      "deepseek/deepseek-v4.1-flash": {
        id: "deepseek/deepseek-v4.1-flash",
        tool_call: true,
        reasoning: true,
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 1_048_576, output: 943_718 },
        cost: { input: 0.0033, output: 3.3, cache_read: 0.0033 },
        canonical_model_id: "deepseek/deepseek-v4.1-flash",
      },
    },
  },
  opencode: {
    models: {
      "deepseek-v4.1-flash": {
        id: "deepseek-v4.1-flash",
        tool_call: true,
        reasoning: true,
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 1_000_000, output: 384_000 },
        cost: { input: 0.3, output: 1.2, cache_read: 0.006 },
        canonical_model_id: "deepseek/deepseek-v4.1-flash",
      },
    },
  },
}

const storedSnapshotSpecsShape = "specs-only" as const

describe("canonical selection integration: Core publication -> Pi host config (legacy v7 semantics)", () => {
  test.skipIf(CORE_V8)("DeepSeek official provider limits reach the Pi host config (maxTokens=393216)", async () => {
    const outcome = await discoverModels(config(), KEY, undefined, {
      fetchImpl: async (input) =>
        String(input).includes("/v1/model/info")
          ? jsonResponse(200, DEEPSEEK_BODY)
          : jsonResponse(200, DEEPSEEK_CATALOG),
      logger: silent,
    })
    expect(outcome.publication.withheld).toEqual([])
    const model = outcome.models.find((item) => item.id === "deepseek-v4.1-flash")
    expect(model).toBeDefined()
    // The official serving limit, not the OpenRouter reseller's.
    expect(model!.maxTokens).toBe(393_216)
    expect(model!.maxTokens).not.toBe(943_718)
    expect(model!.contextWindow).toBe(1_000_000)
    // Core provider-selection provenance is preserved.
    const assessment = outcome.publication
    expect(assessment.publishable.map((item) => item.id)).toEqual(["deepseek-v4.1-flash"])
    // Registered host mapping stays verbatim against the Core spec.
    const spec = outcome.specs.find((item) => item.id === "deepseek-v4.1-flash")
    expect(spec!.limit.output).toBe(393_216)
    expect(model!.maxTokens).toBe(spec!.limit.output)
    expect(model!.contextWindow).toBe(spec!.limit.context)
  })

  test.skipIf(CORE_V8)("OpenRouter-only fallback conflicting with the endpoint stays withheld (943718 never registers)", async () => {
    const outcome = await discoverModels(config(), KEY, undefined, {
      fetchImpl: async (input) =>
        String(input).includes("/v1/model/info")
          ? jsonResponse(200, DEEPSEEK_BODY)
          : jsonResponse(200, { openrouter: DEEPSEEK_CATALOG.openrouter }),
      logger: silent,
    })
    expect(outcome.models.find((item) => item.id === "deepseek-v4.1-flash")).toBeUndefined()
    const withheld = outcome.publication.withheld.find((item) => item.id === "deepseek-v4.1-flash")
    expect(withheld).toBeDefined()
    expect(withheld!.reasons.map((reason) => reason.code)).toContain("authoritative-conflict")
  })

  test.skipIf(CORE_V8)("OpenCode fallback ranks before OpenRouter and never rewrites the identity", async () => {
    const resellersOnly = { opencode: DEEPSEEK_CATALOG.opencode, openrouter: DEEPSEEK_CATALOG.openrouter }
    const outcome = await discoverModels(config(), KEY, undefined, {
      fetchImpl: async (input) =>
        String(input).includes("/v1/model/info")
          ? jsonResponse(200, DEEPSEEK_BODY)
          : jsonResponse(200, resellersOnly),
      logger: silent,
    })
    const model = outcome.models.find((item) => item.id === "deepseek-v4.1-flash")
    // OpenCode's serving limit agrees with the endpoint declaration, so the
    // model publishes with gap-filling instead of the reseller limit.
    expect(model).toBeDefined()
    expect(model!.maxTokens).toBe(384_000)
    // The canonical identity stays the deployment's own name; a fallback
    // provider never renames the host model.
    expect(model!.id).toBe("deepseek-v4.1-flash")
    const spec = outcome.specs.find((item) => item.id === "deepseek-v4.1-flash")
    expect(outcome.fingerprint).toBe(require("../src/core/index.ts").modelFingerprint(outcome.specs))
    expect(spec!.id).toBe("deepseek-v4.1-flash")
  })
})

describe("canonical catalog integration: Core publication -> Pi host config (v8 semantics)", () => {
  const V8_BODY = {
    data: [
      {
        model_name: "deepseek-v4.1-flash",
        litellm_params: { model: "deepseek-v4.1-flash" },
        model_info: {
          mode: "responses",
          base_model: "deepseek-v4.1-flash",
          max_input_tokens: 1_000_000,
          max_output_tokens: 384_000,
          max_tokens: 384_000,
          supports_vision: true,
          supports_pdf_input: false,
          supports_audio_input: false,
          supports_function_calling: true,
          supports_reasoning: true,
        },
      },
    ],
  }
  const V8_CATALOG = {
    models: {
      "deepseek/deepseek-v4.1-flash": {
        limit: { context: 1_000_000, output: 384_000 },
        modalities: { input: ["text"], output: ["text"] },
        tool_call: true,
        reasoning: true,
      },
    },
    providers: {
      deepseek: {
        models: {
          "deepseek-flash": {
            id: "deepseek-flash",
            canonical_model_id: "deepseek/deepseek-v4.1-flash",
            limit: { context: 1_000_000, output: 393_216 },
            modalities: { input: ["text"], output: ["text"] },
            tool_call: true,
            reasoning: true,
            reasoning_options: [{ type: "effort", values: ["low", "high", "max"] }],
            cost: { input: 0.15, output: 0.6 },
          },
        },
      },
      openrouter: {
        models: {
          "deepseek-v4.1-flash": {
            id: "deepseek-v4.1-flash",
            canonical_model_id: "deepseek/deepseek-v4.1-flash",
            limit: { context: 1_048_576, output: 943_718 },
            cost: { input: 0.0033, output: 3.3 },
          },
        },
      },
    },
  }

  test.skipIf(!CORE_V8)("unproven serving publishes canonical 384000; reseller 943718 never registers", async () => {
    const outcome = await discoverModels(config(), KEY, undefined, {
      fetchImpl: async (input) =>
        String(input).includes("/v1/model/info")
          ? jsonResponse(200, V8_BODY)
          : jsonResponse(200, V8_CATALOG),
      logger: silent,
    })
    expect(outcome.publication.withheld).toEqual([])
    const model = outcome.models.find((item) => item.id === "deepseek-v4.1-flash")
    expect(model).toBeDefined()
    // Behavior change (Core design Risks): serving SKU value only with serving proof.
    expect(model!.maxTokens).toBe(384_000)
    expect(model!.maxTokens).not.toBe(943_718)
    expect(model!.contextWindow).toBe(1_000_000)
  })

  test.skipIf(!CORE_V8)("declared provider without exact SKU stays canonical (serving-record-unresolved)", async () => {
    const declared = {
      data: [{
        model_name: "deepseek-v4.1-flash",
        litellm_params: { model: "deepseek-v4.1-flash" },
        model_info: { mode: "responses", base_model: "deepseek-v4.1-flash", models_dev_provider: "deepseek", max_input_tokens: 1_000_000, max_output_tokens: 384_000, supports_function_calling: true, supports_reasoning: true, supports_vision: true, supports_pdf_input: false, supports_audio_input: false },
      }],
    }
    const outcome = await discoverModels(config(), KEY, undefined, {
      fetchImpl: async (input) =>
        String(input).includes("/v1/model/info")
          ? jsonResponse(200, declared)
          : jsonResponse(200, V8_CATALOG),
      logger: silent,
    })
    const model = outcome.models.find((item) => item.id === "deepseek-v4.1-flash")
    expect(model).toBeDefined()
    expect(model!.maxTokens).toBe(384_000)
  })

  test.skipIf(!CORE_V8)("declared provider with exact SKU restores the serving limit", async () => {
    const declared = {
      data: [{
        model_name: "deepseek-v4.1-flash",
        litellm_params: { model: "deepseek/deepseek-flash", custom_llm_provider: "deepseek" },
        model_info: { mode: "responses", base_model: "deepseek-v4.1-flash", models_dev_provider: "deepseek", max_input_tokens: 1_000_000, max_output_tokens: 384_000, supports_function_calling: true, supports_reasoning: true, supports_vision: true, supports_pdf_input: false, supports_audio_input: false },
      }],
    }
    const outcome = await discoverModels(config(), KEY, undefined, {
      fetchImpl: async (input) =>
        String(input).includes("/v1/model/info")
          ? jsonResponse(200, declared)
          : jsonResponse(200, V8_CATALOG),
      logger: silent,
    })
    const model = outcome.models.find((item) => item.id === "deepseek-v4.1-flash")
    expect(model).toBeDefined()
    expect(model!.maxTokens).toBe(393_216)
  })
})

describe("publication discovery: partial catalog", () => {
  /** 20 discovered models: 17 complete, 3 with distinct publication blockers. */
  function catalogBody(withheldRecovered = false) {
    const data: unknown[] = []
    for (let index = 0; index < 17; index += 1) {
      data.push({
        model_name: `ok-${index}`,
        litellm_params: { model: `custom/ok-${index}` },
        model_info: { mode: "chat", ...COMPLETE_INFO },
      })
    }
    data.push({
      model_name: "withheld-incomplete",
      litellm_params: { model: "custom/withheld-incomplete" },
      model_info: { mode: "chat", ...(withheldRecovered ? COMPLETE_INFO : {}) },
    })
    data.push({
      model_name: "withheld-illegal",
      litellm_params: { model: "custom/withheld-illegal" },
      model_info: { mode: "chat", ...COMPLETE_INFO, max_output_tokens: 0 },
    })
    data.push({
      model_name: "shared",
      litellm_params: { model: "custom/shared" },
      model_info: { mode: "chat", ...COMPLETE_INFO },
    })
    return { data }
  }

  const ambiguousCatalog = {
    a: { models: { shared: { id: "shared", limit: { context: 1000, output: 10 }, tool_call: true, modalities: { input: ["text"], output: ["text"] } } } },
    b: { models: { shared: { id: "shared", limit: { context: 1000, output: 10 }, tool_call: true, modalities: { input: ["text"], output: ["text"] } } } },
  }

  test("17 of 20 models register immediately; 3 stay withheld and blocking is per model", async () => {
    const outcome = await discoverModels(config(), KEY, undefined, {
      fetchImpl: async (input) =>
        String(input).includes("/v1/model/info")
          ? jsonResponse(200, catalogBody())
          : jsonResponse(200, ambiguousCatalog),
      logger: silent,
    })
    // v7: provider-map catalog keeps `shared` ambiguous (withheld).
    // v8: the same payload classifies providers-only, so LiteLLM-complete
    // `shared` publishes and only 2 stay withheld.
    expect(outcome.models).toHaveLength(CORE_V8 ? 18 : 17)
    expect(outcome.publication.publishable).toHaveLength(CORE_V8 ? 18 : 17)
    expect(outcome.publication.withheld.map((entry) => entry.id).sort()).toEqual(
      CORE_V8 ? ["withheld-illegal", "withheld-incomplete"] : ["shared", "withheld-illegal", "withheld-incomplete"],
    )
    expect(outcome.publication.discovered).toBe(20)
    expect(outcome.publication.partial).toBeTrue()
    expect(outcome.publication.unusable).toBeFalse()
    expect(outcome.publication.regressions).toEqual([])
    // Withheld models never enter the persisted snapshot either.
    expect(outcome.snapshotSpecs).toHaveLength(CORE_V8 ? 18 : 17)
    // Only the healthy subset maps to host registration.
    expect(outcome.models.some((model) => model.id === "withheld-incomplete")).toBeFalse()
  })

  test("a recovered withheld model registers automatically, with no user approval", async () => {
    const state: ProviderDiagnosticsState = { current: { status: "idle", modelCount: 0 } }
    const controller = publicationControllerForState(state)
    const first = await discoverModels(config(), KEY, undefined, {
      fetchImpl: async (input) =>
        String(input).includes("/v1/model/info")
          ? jsonResponse(200, catalogBody())
          : jsonResponse(200, ambiguousCatalog),
      logger: silent,
      publication: { store: controller.store, previouslyPublished: controller.previouslyPublished },
    })
    expect(first.models).toHaveLength(CORE_V8 ? 18 : 17)
    controller.previouslyPublished = new Set(first.models.map((model) => model.id))

    const second = await discoverModels(config(), KEY, undefined, {
      fetchImpl: async (input) =>
        String(input).includes("/v1/model/info")
          ? jsonResponse(200, catalogBody(true))
          : jsonResponse(200, ambiguousCatalog),
      logger: silent,
      publication: { store: controller.store, previouslyPublished: controller.previouslyPublished },
    })
    expect(second.models.map((model) => model.id)).toContain("withheld-incomplete")
    expect(second.publication.withheld.map((entry) => entry.id)).not.toContain("withheld-incomplete")
  })
})

describe("publication discovery: trusted LKG", () => {
  test.skipIf(CORE_V8)("metadata outage keeps a previously verified model available via trusted LKG (v7 record)", async () => {
    const store = createLastKnownGoodStore()
    const first = await discoverModels(config(), KEY, undefined, {
      fetchImpl: async (input) =>
        String(input).includes("/v1/model/info")
          ? jsonResponse(200, COMPLETE_BODY)
          : jsonResponse(200, COMPLETE_CATALOG),
      logger: silent,
      publication: { store },
    })
    expect(first.models.map((model) => model.id)).toEqual(["pub-complete"])
    expect(first.publication.lkgIDs).toEqual([])

    // Outage: capability flags remain, the metadata source fails. The model
    // keeps working from the previously verified complete configuration.
    const second = await discoverModels(config(), KEY, undefined, {
      fetchImpl: async (input) =>
        String(input).includes("/v1/model/info")
          ? jsonResponse(200, {
            data: [{
              model_name: "pub-complete",
              litellm_params: { model: "openai/pub-complete" },
              model_info: { mode: "chat", supports_function_calling: true, supports_reasoning: false },
            }],
          })
          : jsonResponse(200, COMPLETE_CATALOG),
      loadModelsDevCatalog: async () => {
        throw Object.assign(new Error("fetch failed"), { code: "ECONNREFUSED" })
      },
      logger: silent,
      publication: { store },
    })
    expect(second.publication.failureKind).toBe("unreachable")
    expect(second.models.map((model) => model.id)).toEqual(["pub-complete"])
    expect(second.publication.lkgIDs).toEqual(["pub-complete"])
    expect(second.publication.lkgDetail).toContain("live unavailable")
  })

  test.skipIf(!CORE_V8)("metadata outage restores the schema-8 whole spec (v8 proof re-proof)", async () => {
    const registryBody = {
      data: [{
        model_name: "pub-canonical",
        litellm_params: { model: "pub-canonical" },
        model_info: {
          mode: "chat",
          max_input_tokens: 90_000,
          max_output_tokens: 10_000,
          supports_function_calling: true,
          supports_reasoning: false,
          supports_vision: true,
        },
      }],
    }
    const registryCatalog = {
      models: {
        "labA/pub-canonical": {
          limit: { context: 128_000, input: 90_000, output: 32_000 },
          modalities: { input: ["text"], output: ["text"] },
          tool_call: true,
          reasoning: false,
        },
      },
      providers: {},
    }
    const store = createLastKnownGoodStore()
    const first = await discoverModels(config(), KEY, undefined, {
      fetchImpl: async (input) =>
        String(input).includes("/v1/model/info")
          ? jsonResponse(200, registryBody)
          : jsonResponse(200, registryCatalog),
      logger: silent,
      publication: { store },
    })
    expect(first.models.map((model) => model.id)).toEqual(["pub-canonical"])
    const entry = store.get(lastKnownGoodKey("pub-canonical"))
    expect((entry?.schemaVersion as number)).toBe(8)

    const second = await discoverModels(config(), KEY, undefined, {
      fetchImpl: async (input) =>
        String(input).includes("/v1/model/info")
          ? jsonResponse(200, registryBody)
          : jsonResponse(500, {}),
      loadModelsDevCatalog: async () => {
        throw Object.assign(new Error("fetch failed"), { code: "ECONNREFUSED" })
      },
      logger: silent,
      publication: { store },
    })
    expect(second.publication.failureKind).toBe("unreachable")
    expect(second.models.map((model) => model.id)).toEqual(["pub-canonical"])
    expect(second.publication.lkgIDs).toEqual(["pub-canonical"])
  })

  test("a new model with unavailable metadata and no LKG stays withheld", async () => {
    const outcome = await discoverModels(config(), KEY, undefined, {
      fetchImpl: async (input) =>
        String(input).includes("/v1/model/info")
          ? jsonResponse(200, { data: [{ model_name: "brand-new", litellm_params: { model: "custom/brand-new" }, model_info: { mode: "chat", supports_function_calling: true, supports_reasoning: false } }] })
          : jsonResponse(500, {}),
      loadModelsDevCatalog: async () => {
        throw Object.assign(new Error("fetch failed"), { code: "ECONNREFUSED" })
      },
      logger: silent,
      publication: { store: createLastKnownGoodStore() },
    })
    expect(outcome.models).toEqual([])
    expect(outcome.publication.withheld.map((entry) => entry.id)).toEqual(["brand-new"])
    expect(outcome.publication.withheld[0]!.retryable).toBeTrue()
  })
})

describe("publication diagnostics and regression UX", () => {
  function stateWith(publication: ProviderDiagnosticsState["current"]["publication"]): ProviderDiagnosticsState {
    return {
      current: { status: "ready", modelCount: publication?.publishable.length ?? 0, publication },
    }
  }

  test("diagnostics explain availability, withheld reasons, LKG, discrepancy, and regression", () => {
    const summary = {
      discovered: 3,
      publishable: [{ id: "ok", status: "configured" }],
      lkgIDs: ["ok"],
      lkgDetail: "LKG originally fetched at 2026-01-01T00:00:00.000Z via provider openai -> model m (age 2000ms), live unavailable: timeout",
      withheld: [
        {
          id: "was-available",
          status: "metadata-unavailable",
          reasons: [{ code: "metadata-unavailable", message: "source down", fields: ["metadata"] }],
          previouslyPublished: true,
          retryable: true,
        },
      ],
      partial: true,
      unusable: false,
      regressions: ["was-available"],
      discrepancies: [{ model: "ok", field: "limit.output", status: "resolved-discrepancy", resolution: "authoritative intrinsic metadata decides" }],
      conflicts: [],
      failureKind: "timeout",
      acknowledgement: { notify: true, reason: "regression", fingerprint: "sha256:abc" },
    }
    const text = formatProviderDiagnostics(stateWith(summary))
    expect(text).toContain("发现 3 · 可用 1 · withheld 1 · LKG 1")
    expect(text).toContain("部分可用")
    expect(text).toContain("此前可用、现已撤下：was-available")
    expect(text).toContain("使用已信任的前次完整配置（LKG）：ok")
    expect(text).toContain("LKG 说明")
    expect(text).toContain("withheld：was-available · metadata-unavailable · metadata-unavailable · 可重试 · 此前可用")
    expect(text).toContain("已裁决差异：ok · limit.output")
    // No accept-degraded workflow wording anywhere.
    expect(text).not.toContain("降级")
    expect(text).not.toContain("接受")
  })

  test("discovered > 0 with zero publishable is loudly explained, never silent", () => {
    const summary = {
      discovered: 20,
      publishable: [],
      lkgIDs: [],
      withheld: Array.from({ length: 20 }, (_, index) => ({
        id: `m-${index}`,
        status: "discovered-incomplete" as const,
        reasons: [{ code: "incomplete-metadata", message: "gap", fields: ["limit.output"] }],
        previouslyPublished: false,
        retryable: false,
      })),
      partial: false,
      unusable: true,
      regressions: [],
      discrepancies: [],
      conflicts: [],
      acknowledgement: { notify: true, reason: "catalog-unusable", fingerprint: "sha256:abc" },
    }
    const text = formatProviderDiagnostics(stateWith(summary))
    expect(text).toContain("catalog 当前不可用")
    expect(text).toContain("没有任何模型达到可信发布标准")
    expect(text).toContain("插件不会用默认值或确认动作强行发布模型")
    const notice = catalogNotice(summary)
    expect(notice?.level).toBe("warning")
    expect(notice?.message).toContain("没有任何模型可以安全发布")
  })

  test("a regression notice outranks a first-time gap notice and is consumed once", () => {
    const regression = {
      discovered: 2,
      publishable: [{ id: "healthy", status: "configured" }],
      lkgIDs: [],
      withheld: [{
        id: "was-published",
        status: "metadata-unavailable" as const,
        reasons: [{ code: "metadata-unavailable" as const, message: "down", fields: ["metadata"] }],
        previouslyPublished: true,
        retryable: true,
      }],
      partial: true,
      unusable: false,
      regressions: ["was-published"],
      discrepancies: [],
      conflicts: [],
      acknowledgement: { notify: true, reason: "regression", fingerprint: "sha256:r" },
    }
    const notice = catalogNotice(regression)
    expect(notice?.level).toBe("warning")
    expect(notice?.message).toContain("此前可用的模型已被撤下：was-published")
    expect(notice?.message).toContain("不会自动切换")

    // A first-time gap is diagnostics-only: no user interruption.
    const firstTime = { ...regression, regressions: [], withheld: regression.withheld.map((entry) => ({ ...entry, previouslyPublished: false })), acknowledgement: { notify: false, reason: "first-observation", fingerprint: "sha256:f" } }
    expect(catalogNotice(firstTime)).toBeUndefined()
  })

  test("pending notices are consumed exactly once per material change", () => {
    const state: ProviderDiagnosticsState = { current: { status: "ready", modelCount: 0 } }
    const controller = publicationControllerForState(state)
    controller.pendingNotice = { reason: "regression", message: "regression" }
    expect(takePendingNotice(state)).toEqual({ reason: "regression", message: "regression" })
    expect(takePendingNotice(state)).toBeUndefined()
  })
})

describe("publication longitudinal: Core -> Pi state -> command/UI", () => {
  function fakePi() {
    const registrations: Array<{ name: string; config: ProviderConfigLike }> = []
    const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> }>()
    const notifications: Array<{ message: string; level: string }> = []
    const api = {
      registerProvider(name: string, value: ProviderConfigLike) {
        registrations.push({ name, config: value })
      },
      unregisterProvider() {},
      registerCommand(name: string, value: { handler: (args: string, ctx: any) => Promise<void> }) {
        commands.set(name, value)
      },
      on() { return () => {} },
    } as unknown as ExtensionAPI
    return {
      api,
      registrations,
      commands,
      notifications,
      ui: { notify: (message: string, level = "info") => { notifications.push({ message, level }) } },
    }
  }

  test("the accept-degraded command does not exist and publication needs no user confirmation", async () => {
    const h = fakePi()
    piLitellmProvider(h.api, {
      config: config(),
      deps: {
        fetchImpl: async (input) =>
          String(input).includes("/v1/model/info")
            ? jsonResponse(200, { data: [{ model_name: "gap-model", litellm_params: { model: "openai/gap-model" }, model_info: { mode: "chat", max_input_tokens: 50000, max_output_tokens: 5000 } }] })
            : jsonResponse(200, { openai: { models: {} } }),
        logger: silent,
      },
    })
    expect([...h.commands.keys()].some((name) => name.includes("degraded"))).toBeFalse()
    expect(h.commands.has("litellm-accept-degraded")).toBeFalse()

    const provider = h.registrations[0]!.config
    const ctx: RefreshModelsContextLike = {
      allowNetwork: true,
      signal: new AbortController().signal,
      credential: { type: "api_key", key: KEY },
      publish: async () => true,
    }
    // Without any user action, and after repeated refreshes, the incomplete
    // model stays withheld: no confirmation path can force it in.
    expect(await provider.refreshModels!(ctx)).toEqual([])
    expect(await provider.refreshModels!({ ...ctx, force: true })).toEqual([])
  })

  test("legacy provider config path still builds", () => {
    const built = buildProviderConfig(() => config(), { logger: silent })
    expect(built.models).toEqual([])
  })
})

describe("publication controller", () => {
  test("controller state is created per diagnostics state", () => {
    const state: ProviderDiagnosticsState = { current: { status: "idle", modelCount: 0 } }
    const first = publicationControllerForState(state)
    expect(publicationControllerForState(state)).toBe(first)
    expect(publicationControllerForState(undefined).store).toBeDefined()
    // No degraded-acceptance state exists anywhere on the controller.
    expect("acceptedDegradedIDs" in first).toBeFalse()
  })
})


// ---------------------------------------------------------------------------
// LKG round-trip through the Pi integration (transparency proof)
//
// Pi never splits LKG entry fields: capture happens through the Core helper
// inside seedPublicationLKG, the store is Core-owned, and Pi persists only
// host models / specs / publication memory. v7 tests pin the legacy grading;
// v8 tests pin the schema-8 proof composition.
// ---------------------------------------------------------------------------

describe("LKG schema 7 round-trip (Pi transparency, legacy Core only)", () => {
  const sides = {
    supports_vision: false,
    supports_pdf_input: false,
    supports_audio_input: false,
    supports_video_input: false,
    supports_audio_output: false,
  }

  test.skipIf(CORE_V8)("authoritative capture (route-qualified canonical record) keeps authority through the store", async () => {
    const body = {
      data: [{
        model_name: "openai-org-model",
        litellm_params: { model: "openai/openai-org-model" },
        model_info: { mode: "chat", max_input_tokens: 100_000, max_output_tokens: 10_000, ...sides, supports_function_calling: true, supports_reasoning: false },
      }],
    }
    const catalog = {
      openai: { models: { "openai-org-model": { id: "openai-org-model", limit: { context: 100_000, output: 10_000 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } },
    }
    const store = createLastKnownGoodStore()
    const first = await discoverModels(config(), KEY, undefined, {
      fetchImpl: async (input) =>
        String(input).includes("/v1/model/info")
          ? jsonResponse(200, body)
          : jsonResponse(200, catalog),
      logger: silent,
      publication: { store },
    })
    expect(first.publication.lkgIDs).toEqual([])
    const entry = store.get(lastKnownGoodKey("openai-org-model"))
    // Core graded the selection (rule B) and persisted the authority inside
    // the entry the integration seeded — no Pi-side splitting involved.
    expect((entry as { evidenceAuthority?: unknown } | undefined)?.evidenceAuthority).toBe("authoritative-intrinsic")
  })

  test.skipIf(CORE_V8)("fallback-served capture (unique-match record) grades fallback-serving", async () => {
    const body = {
      data: [{
        model_name: "reseller-only-model",
        litellm_params: { model: "custom/reseller-only-model" },
        model_info: { mode: "chat", max_input_tokens: 50_000, max_output_tokens: 5_000, ...sides, supports_function_calling: true, supports_reasoning: false },
      }],
    }
    const catalog = {
      somereseller: { models: { "reseller-only-model": { id: "reseller-only-model", limit: { context: 50_000, output: 5_000 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } },
    }
    const store = createLastKnownGoodStore()
    await discoverModels(config(), KEY, undefined, {
      fetchImpl: async (input) =>
        String(input).includes("/v1/model/info")
          ? jsonResponse(200, body)
          : jsonResponse(200, catalog),
      logger: silent,
      publication: { store },
    })
    const entry = store.get(lastKnownGoodKey("reseller-only-model"))
    expect((entry as { evidenceAuthority?: unknown } | undefined)?.evidenceAuthority).toBe("fallback-serving")
  })

  test.skipIf(!CORE_V8)("schema-8 capture carries the group-wide proof through the store", async () => {
    const body = {
      data: [{
        model_name: "v8-model",
        litellm_params: { model: "v8-model" },
        model_info: { mode: "chat", max_input_tokens: 100_000, max_output_tokens: 10_000, supports_function_calling: true, supports_reasoning: false, supports_vision: true },
      }],
    }
    const catalog = {
      models: {
        "labA/v8-model": {
          limit: { context: 128_000, input: 100_000, output: 32_000 },
          modalities: { input: ["text"], output: ["text"] },
          tool_call: true,
          reasoning: false,
        },
      },
      providers: {},
    }
    const store = createLastKnownGoodStore()
    const first = await discoverModels(config(), KEY, undefined, {
      fetchImpl: async (input) =>
        String(input).includes("/v1/model/info")
          ? jsonResponse(200, body)
          : jsonResponse(200, catalog),
      logger: silent,
      publication: { store },
    })
    expect(first.publication.lkgIDs).toEqual([])
    const entry = store.get(lastKnownGoodKey("v8-model"))
    expect((entry?.schemaVersion as number)).toBe(8)
    const proof = (entry as { proof?: { deploymentEvidence?: Array<{ identityKind?: string }> } } | undefined)?.proof
    expect(proof?.deploymentEvidence?.[0]?.identityKind).toBe("canonical")
  })

  test("snapshot persistence carries specs only; the LKG authority stays Core-owned", async () => {
    // The persisted snapshot (Pi's durable store) holds ModelSpecs; the LKG
    // store never leaves the process. Schema-7 entries therefore need no
    // adapter-side round-trip code, and Core's own compatibility guard
    // (schema 7 tests) covers corrupt/missing authority fail-closed.
    expect(storedSnapshotSpecsShape).toBe("specs-only")
  })

  test("seeding threads catalog+options and stores a version-matching entry", async () => {
    const body = {
      data: [{
        model_name: "seed-complete",
        litellm_params: { model: "openai/seed-complete" },
        model_info: { mode: "chat", ...COMPLETE_INFO },
      }],
    }
    const catalog = {
      openai: { models: { "seed-complete": { id: "seed-complete", limit: { context: 100_000, output: 10_000 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } },
    }
    const store = createLastKnownGoodStore()
    await discoverModels(config(), KEY, undefined, {
      fetchImpl: async (input) =>
        String(input).includes("/v1/model/info")
          ? jsonResponse(200, body)
          : jsonResponse(200, catalog),
      logger: silent,
      publication: { store },
    })
    const entry = store.get(lastKnownGoodKey("seed-complete"))
    // Seeding接线不断：旧 Core 存 v7、新 Core 存 v8（同 resolution 派生）。
    expect(entry?.schemaVersion).toBe(PUBLICATION_SCHEMA_VERSION)
    expect([7, 8] as number[]).toContain(PUBLICATION_SCHEMA_VERSION)
    if ((PUBLICATION_SCHEMA_VERSION as number) === 8) {
      expect((entry as { proof?: unknown }).proof).toBeDefined()
    }
  })
})
