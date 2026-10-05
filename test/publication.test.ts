import { describe, expect, test, afterEach } from "bun:test"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { createLastKnownGoodStore } from "../src/core/index.ts"
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
    expect(outcome.models).toHaveLength(17)
    expect(outcome.publication.publishable).toHaveLength(17)
    expect(outcome.publication.withheld.map((entry) => entry.id).sort()).toEqual([
      "shared",
      "withheld-illegal",
      "withheld-incomplete",
    ])
    expect(outcome.publication.discovered).toBe(20)
    expect(outcome.publication.partial).toBeTrue()
    expect(outcome.publication.unusable).toBeFalse()
    expect(outcome.publication.regressions).toEqual([])
    // Withheld models never enter the persisted snapshot either.
    expect(outcome.snapshotSpecs).toHaveLength(17)
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
    expect(first.models).toHaveLength(17)
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
  test("metadata outage keeps a previously verified model available via trusted LKG", async () => {
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
