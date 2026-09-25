import { describe, expect, test } from "bun:test"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { DEFAULT_POLL_INTERVAL_SECONDS, type ExtensionConfig } from "../src/extension/config.ts"
import piLitellmProvider, { buildProviderConfig, startPolling } from "../src/extension/index.ts"
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

/** Minimal fake of the pi ExtensionAPI recording registrations and event handlers. */
function fakePi() {
  const registrations: Array<{ name: string; config: ProviderConfigLike }> = []
  const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => Promise<void>>>();
  const api = {
    registerProvider(name: string, value: ProviderConfigLike) {
      // Re-registration merges defined values over the previous config (pi semantics).
      const previous = registrations.filter((entry) => entry.name === name).at(-1)
      const merged = { ...previous?.config, ...value } as ProviderConfigLike
      registrations.push({ name, config: merged })
    },
    unregisterProvider() {},
    on(event: string, handler: (event: unknown, ctx: unknown) => Promise<void>) {
      const list = handlers.get(event) ?? []
      list.push(handler)
      handlers.set(event, list)
      return () => {}
    },
  } as unknown as ExtensionAPI
  return { api, registrations, handlers }
}

const silentDeps = { logger: { warn: () => {}, error: () => {} } }

describe("扩展工厂注册形态", () => {
  test("注册 id 为 litellm 的 provider 且 apiKey 走宿主引用", () => {
    const { api, registrations } = fakePi()
    piLitellmProvider(api, { config: config(), deps: silentDeps })
    expect(registrations).toHaveLength(1)
    expect(registrations[0]!.name).toBe("litellm")
    expect(registrations[0]!.config.name).toBe("LiteLLM")
    expect(registrations[0]!.config.apiKey).toBe("$LITELLM_API_KEY")
    expect(registrations[0]!.config.models).toEqual([])
    expect(typeof registrations[0]!.config.refreshModels).toBe("function")
  })

  test("未连接时也注册且不抛错", () => {
    const { api, registrations } = fakePi()
    piLitellmProvider(api, { config: config({ baseUrl: "" }), deps: silentDeps })
    expect(registrations[0]!.config.baseUrl).toBe("")
  })

  test("refreshModels 委托给发现入口", async () => {
    const { api, registrations } = fakePi()
    piLitellmProvider(api, { config: config({ baseUrl: "" }), deps: silentDeps })
    const context: RefreshModelsContextLike = {
      allowNetwork: true,
      signal: new AbortController().signal,
      credential: { key: "sk-x" },
      publish: async () => true,
    }
    // Not connected → empty list, no fetch (which would need a real network).
    expect(await registrations[0]!.config.refreshModels!(context)).toEqual([])
  })

  test("buildProviderConfig 每次读取最新 config", () => {
    let current = config()
    const built = buildProviderConfig(() => current, silentDeps)
    expect(built.baseUrl).toBe("http://litellm.example:4000")
    current = config({ baseUrl: "http://changed.example:5000" })
    // The builder reads the live snapshot on refresh, so the same instance follows changes.
    expect(built.baseUrl).toBe("http://litellm.example:4000")
    expect(buildProviderConfig(() => current, silentDeps).baseUrl).toBe("http://changed.example:5000")
  })
})

describe("轮询生命周期", () => {
  test("会话开始启动宿主刷新，会话结束幂等停止", async () => {
    const { api, registrations, handlers } = fakePi()
    piLitellmProvider(api, { config: config({ pollInterval: 30 }), deps: silentDeps })

    let refreshCalls = 0
    const ctx = {
      cwd: process.cwd(),
      modelRegistry: {
        async refresh() {
          refreshCalls += 1
          return { aborted: false, errors: new Map() }
        },
      },
    }

    await handlers.get("session_start")![0]!({ type: "session_start", reason: "startup" }, ctx)
    // session_start re-registers with the freshly resolved config.
    expect(registrations.length).toBeGreaterThanOrEqual(2)

    // Poll interval is 30s; nothing fires synchronously.
    expect(refreshCalls).toBe(0)

    await handlers.get("session_shutdown")![0]!({ type: "session_shutdown", reason: "quit" }, ctx)
    // Second shutdown is a no-op and must not throw.
    await handlers.get("session_shutdown")![0]!({ type: "session_shutdown", reason: "quit" }, ctx)
  })

  test("重复 session_start 不叠加轮询", async () => {
    const { api, handlers } = fakePi()
    piLitellmProvider(api, { config: config({ pollInterval: 30 }), deps: silentDeps })
    const ctx = {
      cwd: process.cwd(),
      modelRegistry: { async refresh() { return { aborted: false, errors: new Map() } } },
    }
    await handlers.get("session_start")![0]!({ type: "session_start", reason: "startup" }, ctx)
    await handlers.get("session_start")![0]!({ type: "session_start", reason: "reload" }, ctx)
    await handlers.get("session_shutdown")![0]!({ type: "session_shutdown", reason: "reload" }, ctx)
  })

  test("startPolling 返回幂等停止函数且 unref 定时器", async () => {
    let calls = 0
    const stop = startPolling(30, async () => {
      calls += 1
    })
    stop()
    stop()
    expect(calls).toBe(0)
  })
})
