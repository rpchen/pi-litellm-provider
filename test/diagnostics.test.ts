import { describe, expect, test } from "bun:test"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { DEFAULT_POLL_INTERVAL_SECONDS, type ExtensionConfig } from "../src/extension/config.ts"
import {
  createProviderDiagnosticsState,
  formatProviderDiagnostics,
} from "../src/extension/diagnostics.ts"
import piLitellmProvider, { buildProviderConfig } from "../src/extension/index.ts"
import type { ProviderConfigLike, RefreshModelsContextLike } from "../src/extension/types.ts"

function config(overrides: Partial<ExtensionConfig> = {}): ExtensionConfig {
  return {
    baseUrl: "http://litellm.example:4000",
    pollInterval: DEFAULT_POLL_INTERVAL_SECONDS,
    contextTierCap: true,
    protocolOverrides: {},
    globalConfigPath: "unused",
    projectConfigPath: "unused",
    ...overrides,
  }
}

const body = {
  data: [{
    model_name: "gpt-diagnostics",
    litellm_params: { model: "openai/gpt-diagnostics" },
    model_info: {
      supported_endpoints: ["/v1/responses"],
      max_input_tokens: 100000,
      max_output_tokens: 10000,
    },
  }],
}

const catalog = {
  openai: {
    models: {
      "gpt-diagnostics": {
        id: "gpt-diagnostics",
        release_date: "2026-05-01",
        modalities: { input: ["text"], output: ["text"] },
      },
    },
  },
}

function refreshContext(overrides: Partial<RefreshModelsContextLike> = {}): RefreshModelsContextLike {
  return {
    allowNetwork: true,
    signal: new AbortController().signal,
    credential: { type: "api_key", key: "sk-diagnostics-secret" },
    publish: async () => true,
    ...overrides,
  }
}

function fakePi() {
  const registrations: Array<{ name: string; config: ProviderConfigLike }> = []
  let command: { handler: (args: string, ctx: unknown) => Promise<void> } | undefined
  const api = {
    registerProvider(name: string, value: ProviderConfigLike) {
      registrations.push({ name, config: value })
    },
    unregisterProvider() {},
    registerCommand(name: string, value: { handler: (args: string, ctx: unknown) => Promise<void> }) {
      if (name === "litellm-diagnostics") command = value
    },
    on() { return () => {} },
  } as unknown as ExtensionAPI
  return { api, registrations, get command() { return command! } }
}

describe("PR7 Pi diagnostics closure", () => {
  test("fixture → discovery → diagnostics state → /litellm-diagnostics → ui.notify is one zero-model-turn path", async () => {
    const h = fakePi()
    piLitellmProvider(h.api, {
      config: config(),
      deps: {
        fetchImpl: async () => new Response(JSON.stringify(body), { status: 200 }),
        loadModelsDevCatalog: async () => catalog,
        logger: { warn: () => {}, error: () => {} },
      },
    })

    const provider = h.registrations[0]!.config
    const models = await provider.refreshModels!(refreshContext())
    expect(models.map((model) => model.id)).toEqual(["gpt-diagnostics"])

    const notifications: Array<{ message: string; level: string }> = []
    const commandContext = new Proxy({
      ui: {
        notify(message: string, level: string) {
          notifications.push({ message, level })
        },
      },
    }, {
      get(target, property) {
        if (property === "ui") return target.ui
        throw new Error(`diagnostics command touched unexpected host API: ${String(property)}`)
      },
    })

    await h.command.handler("", commandContext)
    expect(notifications).toHaveLength(1)
    expect(notifications[0]!.level).toBe("info")
    expect(notifications[0]!.message).toContain("状态：正常")
    expect(notifications[0]!.message).toContain("已注册模型：1")
    expect(notifications[0]!.message).toContain("缓存：network")
    expect(notifications[0]!.message).toContain("models.dev：ok · 命中 1/1")
    expect(notifications[0]!.message).toContain("协议 fallback：0")
    expect(notifications[0]!.message).toContain("Core：main@")
    expect(notifications[0]!.message).not.toContain("sk-diagnostics-secret")
    expect(notifications[0]!.message).not.toContain("litellm.example")
  })

  test("diagnostics state directly distinguishes network, memory-cache, stale and auth destructive failure", async () => {
    const state = createProviderDiagnosticsState()
    let mode: "ok" | "network-error" | "auth" = "ok"
    const built = buildProviderConfig(() => config(), {
      fetchImpl: async () => {
        if (mode === "network-error") {
          throw new Error("transport sk-diagnostics-secret https://private.example internal failure")
        }
        return new Response(JSON.stringify(mode === "auth" ? {} : body), {
          status: mode === "auth" ? 401 : 200,
        })
      },
      loadModelsDevCatalog: async () => catalog,
      logger: { warn: () => {}, error: () => {} },
    }, state)

    await built.refreshModels!(refreshContext())
    expect(state.current.status).toBe("ready")
    expect(state.current.cache?.source).toBe("network")
    expect(state.current.discovery?.modelsDev.status).toBe("ok")

    await built.refreshModels!(refreshContext())
    expect(state.current.cache?.source).toBe("memory-cache")
    expect(state.current.status).toBe("ready")

    mode = "network-error"
    await built.refreshModels!(refreshContext({ force: true }))
    expect(state.current.status).toBe("stale")
    expect(state.current.cache?.source).toBe("stale")
    const staleText = formatProviderDiagnostics(state)
    expect(staleText).not.toContain("sk-diagnostics-secret")
    expect(staleText).not.toContain("private.example")
    expect(staleText).not.toContain("internal failure")

    mode = "auth"
    expect(await built.refreshModels!(refreshContext({ force: true }))).toEqual([])
    expect(state.current.status).toBe("auth-error")
    expect(state.current.modelCount).toBe(0)
    expect(state.current.cache?.source).toBe("none")
  })

  test("endpoint-compatible persisted result reports snapshot/restored before network access", async () => {
    let persisted: unknown
    const sourceState = createProviderDiagnosticsState()
    const source = buildProviderConfig(() => config(), {
      fetchImpl: async () => new Response(JSON.stringify(body), { status: 200 }),
      loadModelsDevCatalog: async () => catalog,
      logger: { warn: () => {}, error: () => {} },
    }, sourceState)
    await source.refreshModels!(refreshContext({
      publish: async (publication) => {
        persisted = publication.persist
        return true
      },
    }))

    const restoredState = createProviderDiagnosticsState()
    const restored = buildProviderConfig(() => config(), undefined, restoredState)
    const models = await restored.refreshModels!({
      allowNetwork: false,
      credential: { type: "api_key", key: "sk-diagnostics-secret" },
      stored: persisted as NonNullable<RefreshModelsContextLike["stored"]>,
    })
    expect(models.map((model) => model.id)).toEqual(["gpt-diagnostics"])
    expect(restoredState.current.status).toBe("restored")
    expect(restoredState.current.cache?.source).toBe("snapshot")
    expect(restoredState.current.cache?.stale).toBeTrue()
  })
})
