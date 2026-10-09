import { describe, expect, test } from "bun:test"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { PUBLICATION_SCHEMA_VERSION } from "../src/core/index.ts"
import { DEFAULT_POLL_INTERVAL_SECONDS, type ExtensionConfig } from "../src/extension/config.ts"
import {
  createProviderDiagnosticsState,
  formatHostDateTime,
  formatModelDetails,
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
      supports_function_calling: false,
      supports_reasoning: false,
      supports_vision: false,
      supports_pdf_input: false,
      supports_audio_input: false,
      supports_video_input: false,
      supports_audio_output: false,
    },
  }],
}

const catalog = {
  models: {
    "openai/gpt-diagnostics": {
      limit: { context: 100000, output: 10000 },
      modalities: { input: ["text"], output: ["text"] },
      tool_call: false,
      reasoning: false,
      release_date: "2026-05-01",
    },
  },
  providers: {
    openai: {
      models: {
        "gpt-diagnostics": {
          id: "gpt-diagnostics",
          canonical_model_id: "openai/gpt-diagnostics",
          release_date: "2026-05-01",
          modalities: { input: ["text"], output: ["text"] },
          limit: { context: 100000, output: 10000 },
          tool_call: false,
          reasoning: false,
        },
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
  test("用户可见诊断时间按宿主时区显示，而内部 instant 保持不变", () => {
    const instant = "2026-09-29T01:07:32.160Z"
    expect(formatHostDateTime(instant, -480)).toBe("2026-09-29 09:07:32 UTC+08:00")

    const state = createProviderDiagnosticsState()
    state.current = {
      status: "stale",
      modelCount: 1,
      lastSuccessfulDiscoveryAt: instant,
      cache: {
        source: "stale",
        stale: true,
        refreshedAt: Date.parse(instant),
        ageMs: 0,
        failureCount: 1,
        nextRetryAt: Date.parse("2026-09-29T01:10:00.000Z"),
        pending: false,
      },
    }
    const text = formatProviderDiagnostics(
      state,
      Date.parse("2026-09-29T01:08:32.160Z"),
      -480,
    )
    expect(text).toContain("最近成功发现：2026-09-29 09:07:32 UTC+08:00")
    expect(text).toContain("下次允许重试：2026-09-29 09:10:00 UTC+08:00")
    expect(state.current.lastSuccessfulDiscoveryAt).toBe(instant)
  })

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

    await h.command.handler("default", commandContext)
    expect(notifications).toHaveLength(1)
    expect(notifications[0]!.level).toBe("info")
    expect(notifications[0]!.message).toContain("状态：正常")
    expect(notifications[0]!.message).toContain("已注册模型：1")
    expect(notifications[0]!.message).toContain("缓存：network")
    // Catalog-shape fixture: new Core resolves complete with no serving
    // record matched; old Core cannot read the shape (degraded, LiteLLM-only).
    expect(notifications[0]!.message).toContain("命中 0/1")
    expect(notifications[0]!.message).toContain(
      (PUBLICATION_SCHEMA_VERSION as number) === 8 ? "models.dev：ok" : "models.dev：degraded",
    )
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
    // Catalog-shape fixture：新 Core 判 complete，旧 Core 读不出 shape（degraded）。
    expect(state.current.discovery?.modelsDev.status).toBe(
      (PUBLICATION_SCHEMA_VERSION as number) === 8 ? "ok" : "degraded",
    )

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

describe("canonical catalog model details", () => {
  function discoveryWith(models: unknown[]) {
    return { models } as never
  }

  test("新 Core 全字段渲染 canonical/serving/档位/operator-config/候选/shape", () => {
    const lines = formatModelDetails(discoveryWith([{
      id: "m",
      deploymentCount: 1,
      quality: {
        identity: { canonicalModelID: "labA/m", canonicalEvidence: "registry-unique", canonicalStatus: "proven" },
        serving: { status: "serving-record-unresolved", providerID: "gatewayX" },
        reasoningLevelsState: "unknown",
        operatorConfigurationKeys: ["litellm_params.reasoning_effort"],
        diagnosticCandidates: [{ providerID: "gatewayX", recordID: "m-free", why: "relation-only SKU" }],
        catalogKind: "complete",
      },
      publication: { reasoningLevels: [] },
    }]))
    const text = lines.join("\n")
    expect(text).toContain("canonical labA/m（registry-unique）")
    expect(text).toContain("serving serving-record-unresolved gatewayX")
    expect(text).toContain("档位 unknown")
    expect(text).toContain("operator configuration")
    expect(text).not.toContain("hard-enforced")
    expect(text).toContain("gatewayX/m-free")
  })

  test("旧 Core 缺失字段时省略对应行", () => {
    const lines = formatModelDetails(discoveryWith([{
      id: "m",
      deploymentCount: 1,
      quality: {},
      publication: {},
    }]))
    const text = lines.join("\n")
    expect(text).toContain("m · 部署 1")
    expect(text).not.toContain("canonical")
    expect(text).not.toContain("serving")
    expect(text).not.toContain("档位")
  })

  test("空模型列表无明细块", () => {
    expect(formatModelDetails(undefined)).toEqual([])
    expect(formatModelDetails(discoveryWith([]))).toEqual([])
  })
})
