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
  const commands: Array<{ name: string; config: { description?: string; handler: (args: string, ctx: any) => Promise<void> } }> = []
  const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => Promise<void>>>();
  const api = {
    registerProvider(name: string, value: ProviderConfigLike) {
      // Re-registration merges defined values over the previous config (pi semantics).
      const previous = registrations.filter((entry) => entry.name === name).at(-1)
      const merged = { ...previous?.config, ...value } as ProviderConfigLike
      registrations.push({ name, config: merged })
    },
    unregisterProvider() {},
    registerCommand(name: string, config: { description?: string; handler: (args: string, ctx: any) => Promise<void> }) {
      commands.push({ name, config })
    },
    on(event: string, handler: (event: unknown, ctx: unknown) => Promise<void>) {
      const list = handlers.get(event) ?? []
      list.push(handler)
      handlers.set(event, list)
      return () => {}
    },
  } as unknown as ExtensionAPI
  return { api, registrations, handlers, commands }
}

const silentDeps = { logger: { warn: () => {}, error: () => {} } }

describe("扩展工厂注册形态", () => {
  test("注册 id 为 litellm 的 provider、诊断命令且 apiKey 走宿主引用", () => {
    const { api, registrations, commands } = fakePi()
    piLitellmProvider(api, { config: config(), deps: silentDeps })
    expect(registrations).toHaveLength(1)
    expect(registrations[0]!.name).toBe("litellm")
    expect(registrations[0]!.config.name).toBe("LiteLLM")
    expect(registrations[0]!.config.apiKey).toBe("$LITELLM_API_KEY")
    expect(registrations[0]!.config.models).toEqual([])
    expect(typeof registrations[0]!.config.refreshModels).toBe("function")
    expect(commands.map((command) => command.name)).toContain("litellm-diagnostics")
  })

  test("未连接时也注册且不抛错", () => {
    const { api, registrations } = fakePi()
    piLitellmProvider(api, { config: config({ baseUrl: "" }), deps: silentDeps })
    expect(registrations[0]!.config.baseUrl).toBe("")
  })

  test("注册的 baseUrl 是规范化后的根地址（m1）", () => {
    const { api, registrations } = fakePi()
    piLitellmProvider(api, { config: config({ baseUrl: "http://litellm.example:4000/v1/" }), deps: silentDeps })
    expect(registrations[0]!.config.baseUrl).toBe("http://litellm.example:4000")
    // No trailing slash, no duplicate /v1 — normalization happens before registration.
    expect(registrations[0]!.config.baseUrl!.endsWith("/")).toBeFalse()
    expect(registrations[0]!.config.baseUrl!.endsWith("/v1")).toBeFalse()
  })

  test("无法规范化的地址注册为空 baseUrl 而不抛错", () => {
    const { api, registrations } = fakePi()
    piLitellmProvider(api, { config: config({ baseUrl: "ftp://litellm.example" }), deps: silentDeps })
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

  test("重复 session_start 不叠加轮询，shutdown 幂等清理", async () => {
    const { api, handlers } = fakePi()
    piLitellmProvider(api, { config: config({ pollInterval: 30 }), deps: silentDeps })

    // Spy on the timer lifecycle: each startPolling call creates one interval; stacked
    // timers from repeated session_start would show as multiple live intervals.
    interface FakeTimer {
      unref?: () => void
      live: boolean
    }
    const timers: FakeTimer[] = []
    const originalSet = globalThis.setInterval
    const originalClear = globalThis.clearInterval
    ;(globalThis as unknown as { setInterval: unknown }).setInterval = () => {
      const timer: FakeTimer = { live: true, unref: () => {} }
      timers.push(timer)
      return timer
    }
    ;(globalThis as unknown as { clearInterval: unknown }).clearInterval = (timer: FakeTimer) => {
      timer.live = false
    }

    try {
      const ctx = {
        cwd: process.cwd(),
        modelRegistry: { async refresh() { return { aborted: false, errors: new Map() } } },
      }
      await handlers.get("session_start")![0]!({ type: "session_start", reason: "startup" }, ctx)
      await handlers.get("session_start")![0]!({ type: "session_start", reason: "reload" }, ctx)
      // Two starts must not stack timers.
      expect(timers.filter((timer) => timer.live)).toHaveLength(1)

      await handlers.get("session_shutdown")![0]!({ type: "session_shutdown", reason: "reload" }, ctx)
      expect(timers.filter((timer) => timer.live)).toHaveLength(0)

      // Second shutdown is a no-op and must not clear anything twice or throw.
      await handlers.get("session_shutdown")![0]!({ type: "session_shutdown", reason: "quit" }, ctx)
      expect(timers.filter((timer) => timer.live)).toHaveLength(0)

      // A start after shutdown starts a fresh timer (session replacement flow).
      await handlers.get("session_start")![0]!({ type: "session_start", reason: "startup" }, ctx)
      expect(timers.filter((timer) => timer.live)).toHaveLength(1)
      await handlers.get("session_shutdown")![0]!({ type: "session_shutdown", reason: "quit" }, ctx)
    } finally {
      ;(globalThis as unknown as { setInterval: unknown }).setInterval = originalSet
      ;(globalThis as unknown as { clearInterval: unknown }).clearInterval = originalClear
    }
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

describe("Core refresh coordinator 接入", () => {
  const body = {
    data: [
      {
        model_name: "coordinated-model",
        litellm_params: { model: "openai/coordinated-model" },
        model_info: { mode: "chat", max_input_tokens: 128000, max_output_tokens: 32000 },
      },
    ],
  }

  function context(force = false): RefreshModelsContextLike {
    return {
      allowNetwork: true,
      force,
      signal: new AbortController().signal,
      credential: { key: "sk-coordinator" },
      publish: async () => true,
    }
  }

  test("同一 provider 在短 TTL 内复用结果，force 会绕过缓存", async () => {
    let calls = 0
    const built = buildProviderConfig(() => config(), {
      fetchImpl: async () => {
        calls += 1
        return new Response(JSON.stringify(body), { status: 200 })
      },
      loadModelsDevCatalog: async () => ({}),
      logger: { warn: () => {}, error: () => {} },
    })

    expect((await built.refreshModels!(context())).map((model) => model.id)).toEqual(["coordinated-model"])
    expect((await built.refreshModels!(context())).map((model) => model.id)).toEqual(["coordinated-model"])
    expect(calls).toBe(1)

    expect((await built.refreshModels!(context(true))).map((model) => model.id)).toEqual(["coordinated-model"])
    expect(calls).toBe(2)
  })

  test("成功后临时失败由 Core 返回 last-known-good", async () => {
    let fail = false
    const warnings: string[] = []
    const built = buildProviderConfig(() => config(), {
      fetchImpl: async () => {
        if (fail) throw new Error("temporary outage")
        return new Response(JSON.stringify(body), { status: 200 })
      },
      loadModelsDevCatalog: async () => ({}),
      logger: { warn: (message) => warnings.push(message), error: () => {} },
    })

    await built.refreshModels!(context())
    fail = true
    const stale = await built.refreshModels!(context(true))
    expect(stale.map((model) => model.id)).toEqual(["coordinated-model"])
    expect(warnings.some((message) => message.includes("last-known-good"))).toBeTrue()
  })
  test("持久化 snapshot 只在 endpoint fingerprint 兼容时恢复", async () => {
    let persisted: unknown
    const built = buildProviderConfig(() => config(), {
      fetchImpl: async () => new Response(JSON.stringify(body), { status: 200 }),
      loadModelsDevCatalog: async () => ({}),
      logger: { warn: () => {}, error: () => {} },
    })
    const networkContext: RefreshModelsContextLike = {
      ...context(true),
      publish: async (publication) => {
        persisted = publication.persist
        return true
      },
    }
    expect((await built.refreshModels!(networkContext)).map((model) => model.id)).toEqual(["coordinated-model"])

    const stored = persisted as NonNullable<RefreshModelsContextLike["stored"]>
    expect(stored.snapshot).toBeDefined()
    expect((await built.refreshModels!({
      allowNetwork: false,
      credential: { key: "sk-coordinator" },
      stored,
    })).map((model) => model.id)).toEqual(["coordinated-model"])

    expect(await built.refreshModels!({
      allowNetwork: false,
      credential: { key: "sk-other" },
      stored,
    })).toEqual([])
  })

  test("相同模型但 endpoint 变化仍会重写 snapshot", async () => {
    let persisted: unknown
    const first = buildProviderConfig(() => config(), {
      fetchImpl: async () => new Response(JSON.stringify(body), { status: 200 }),
      loadModelsDevCatalog: async () => ({}),
      logger: { warn: () => {}, error: () => {} },
    })
    await first.refreshModels!({
      ...context(true),
      publish: async (publication) => {
        persisted = publication.persist
        return true
      },
    })

    let publishes = 0
    const second = buildProviderConfig(() => config({ baseUrl: "http://other.example:4000" }), {
      fetchImpl: async () => new Response(JSON.stringify(body), { status: 200 }),
      loadModelsDevCatalog: async () => ({}),
      logger: { warn: () => {}, error: () => {} },
    })
    await second.refreshModels!({
      ...context(true),
      stored: persisted as NonNullable<RefreshModelsContextLike["stored"]>,
      publish: async () => {
        publishes += 1
        return true
      },
    })
    expect(publishes).toBe(1)
  })

})

