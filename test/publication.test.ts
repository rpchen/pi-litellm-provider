import { describe, expect, test, afterEach } from "bun:test"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { createLastKnownGoodStore } from "../src/core/index.ts"
import { resetModelsDevCacheForTest } from "../src/net/fetch.ts"
import { discoverModels } from "../src/extension/discovery.ts"
import {
  formatProviderDiagnostics,
  publicationControllerForState,
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

const COMPLETE_BODY = {
  data: [
    {
      model_name: "pub-complete",
      litellm_params: { model: "openai/pub-complete" },
      model_info: { mode: "chat", max_input_tokens: 100000, max_output_tokens: 10000 },
    },
  ],
}

const COMPLETE_CATALOG = {
  openai: {
    models: {
      "pub-complete": {
        id: "pub-complete",
        limit: { context: 100000, output: 10000 },
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
    expect(outcome.publication.blocked.map((model) => model.id)).toEqual(["pub-incomplete"])
    // Mapping an empty publishable partition registers nothing.
    expect(toProviderModelsWithPublication([], BASE)).toEqual([])
  })
})

describe("publication discovery", () => {
  test("complete models register; incomplete never disguise as normal", async () => {
    const outcome = await discoverModels(config(), KEY, undefined, {
      fetchImpl: async (input) =>
        String(input).includes("/v1/model/info")
          ? jsonResponse(200, {
            data: [...COMPLETE_BODY.data, ...INCOMPLETE_BODY.data],
          })
          : jsonResponse(200, COMPLETE_CATALOG),
      logger: silent,
    })
    expect(outcome.models.map((model) => model.id)).toEqual(["pub-complete"])
    expect(outcome.publication.blocked.map((model) => model.id)).toEqual(["pub-incomplete"])
    const blocked = outcome.publication.blocked[0]!
    expect(blocked.gaps.length).toBeGreaterThan(0)
  })

  test("accepted degradation registers on the degraded path and stays labeled", async () => {
    const store = createLastKnownGoodStore()
    const accepted = new Set<string>(["pub-incomplete"])
    const outcome = await discoverModels(config(), KEY, undefined, {
      fetchImpl: async (input) =>
        String(input).includes("/v1/model/info")
          ? jsonResponse(200, INCOMPLETE_BODY)
          : jsonResponse(200, { openai: { models: {} } }),
      logger: silent,
      publication: { store, acceptedDegradedIDs: accepted },
    })
    // pub-incomplete has no operational limits, so the adapter guard still
    // excludes it from host registration; the degraded state itself is what
    // matters here and must be visible, never configured.
    expect(outcome.publication.degradedIDs).toEqual(["pub-incomplete"])
    for (const id of outcome.publication.degradedIDs) {
      expect(outcome.publication.publishable.find((model) => model.id === id)?.status).toBe("degraded")
    }
  })

  test("diagnostics display names blocked models, gaps, LKG, and degraded", async () => {
    const outcome = await discoverModels(config(), KEY, undefined, {
      fetchImpl: async (input) =>
        String(input).includes("/v1/model/info")
          ? jsonResponse(200, {
            data: [...COMPLETE_BODY.data, ...INCOMPLETE_BODY.data],
          })
          : jsonResponse(200, COMPLETE_CATALOG),
      logger: silent,
    })
    const state: ProviderDiagnosticsState = {
      current: {
        status: "ready",
        modelCount: outcome.models.length,
        models: outcome.models,
        discovery: outcome.diagnostics,
        publication: outcome.publication,
      },
    }
    const text = formatProviderDiagnostics(state)
    expect(text).toContain("pub-incomplete")
    expect(text).toContain("未完成")
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

  test("blocked model -> accept command -> degraded registration with gaps", async () => {
    const h = fakePi()
    const endpointConfig = config()
    piLitellmProvider(h.api, {
      config: endpointConfig,
      deps: {
        fetchImpl: async (input) =>
          String(input).includes("/v1/model/info")
            ? jsonResponse(200, {
              data: [
                {
                  model_name: "gap-model",
                  litellm_params: { model: "openai/gap-model" },
                  // Complete limits but unknown tools/reasoning: degradable.
                  model_info: { mode: "chat", max_input_tokens: 50000, max_output_tokens: 5000 },
                },
              ],
            })
            : jsonResponse(200, { openai: { models: {} } }),
        logger: silent,
      },
    })
    const provider = h.registrations[0]!.config
    const ctx: RefreshModelsContextLike = {
      allowNetwork: true,
      signal: new AbortController().signal,
      credential: { type: "api_key", key: KEY },
      publish: async () => true,
    }
    expect((await provider.refreshModels!(ctx)).map((model) => model.id)).toEqual([])

    const accept = h.commands.get("litellm-accept-degraded")!
    await accept.handler(
      `default gap-model`,
      { ui: h.ui, modelRegistry: { refresh: async () => {} } },
    )
    expect(h.notifications.some((item) => item.message.includes("已接受降级") && item.message.includes("gap-model"))).toBeTrue()

    const after = await provider.refreshModels!({ ...ctx, force: true })
    expect(after.map((model) => model.id)).toEqual(["gap-model"])
  })

  test("accept-degraded rejects invalid metadata without claiming success", async () => {
    const h = fakePi()
    piLitellmProvider(h.api, {
      config: config(),
      deps: {
        fetchImpl: async (input) =>
          String(input).includes("/v1/model/info")
            ? jsonResponse(200, {
              data: [{
                model_name: "invalid-model",
                litellm_params: { model: "openai/invalid-model" },
                model_info: {
                  mode: "chat",
                  max_input_tokens: 0,
                  max_output_tokens: 100,
                  supports_function_calling: true,
                  supports_reasoning: false,
                  supports_vision: false,
                  supports_audio_output: false,
                },
              }],
            })
            : jsonResponse(200, { openai: { models: { "invalid-model": { id: "invalid-model" } } } }),
        logger: silent,
      },
    })
    const provider = h.registrations[0]!.config
    await provider.refreshModels!({
      allowNetwork: true,
      signal: new AbortController().signal,
      credential: { type: "api_key", key: KEY },
      publish: async () => true,
    })
    await h.commands.get("litellm-accept-degraded")!.handler(
      "default invalid-model",
      { ui: h.ui, modelRegistry: { refresh: async () => {} } },
    )
    expect(h.notifications.some((item) => item.message.includes("已接受降级"))).toBeFalse()
    expect(h.notifications.some((item) => item.message.includes("拒绝降级") && item.message.includes("invalid-model"))).toBeTrue()
  })
})

describe("publication controller", () => {
  test("controller state is created per diagnostics state", () => {
    const state: ProviderDiagnosticsState = { current: { status: "idle", modelCount: 0 } }
    const first = publicationControllerForState(state)
    expect(publicationControllerForState(state)).toBe(first)
    expect(publicationControllerForState(undefined).store).toBeDefined()
  })

  test("legacy provider config path still builds", () => {
    const built = buildProviderConfig(() => config(), { logger: silent })
    expect(built.models).toEqual([])
  })
})
