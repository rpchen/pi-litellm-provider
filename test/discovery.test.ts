import { afterEach, describe, expect, test } from "bun:test"
import {
  createDiscoverySnapshot,
  createLastKnownGoodStore,
  endpointFingerprint,
  PUBLICATION_SCHEMA_VERSION,
  type ModelSpec,
} from "../src/core/index.ts"
import { discoverModels, refreshProviderModels } from "../src/extension/discovery.ts"
import { DEFAULT_POLL_INTERVAL_SECONDS, type ExtensionConfig } from "../src/extension/config.ts"
import { createProviderDiagnosticsState, takePendingNotice } from "../src/extension/diagnostics.ts"
import { resetModelsDevCacheForTest, type FetchLike } from "../src/net/fetch.ts"
import type { ProviderModelConfigLike, RefreshModelsContextLike } from "../src/extension/types.ts"

const KEY = "sk-litellm-secret"
const BASE = "http://litellm.example:4000"

/** Stored-catalog entries only need identity fields for these tests. */
function storedModel(id: string): ProviderModelConfigLike {
  return {
    id,
    name: id,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1,
    maxTokens: 1,
  }
}

function storedSpec(id: string): ModelSpec {
  return {
    id,
    name: id,
    protocol: "chat",
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    variants: [],
    released: 0,
    releaseUnit: "none",
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    limit: { context: 1, input: 1, output: 1 },
  }
}

function restoreFingerprintFor(value = config()) {
  return endpointFingerprint({
    endpointID: value.endpointId,
    baseUrl: value.baseUrl,
    credentialKey: "pi-restore-scope-v1",
    buildOptions: {
      contextTierCap: value.contextTierCap,
      protocolOverrides: value.protocolOverrides,
    },
  })
}

function snapshotFor(id: string, key = KEY, value = config()) {
  return createDiscoverySnapshot(
    endpointFingerprint({
      endpointID: value.endpointId,
      baseUrl: value.baseUrl,
      credentialKey: key,
      buildOptions: {
        contextTierCap: value.contextTierCap,
        protocolOverrides: value.protocolOverrides,
      },
    }),
    [storedSpec(id)],
    "2026-09-28T00:00:00.000Z",
  )
}

function config(overrides: Partial<ExtensionConfig> = {}): ExtensionConfig {
  return {
    baseUrl: BASE,
    pollInterval: DEFAULT_POLL_INTERVAL_SECONDS,
    contextTierCap: true,
    protocolOverrides: {},
    globalConfigPath: "unused",
    projectConfigPath: "unused",
    ...overrides,
  }
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

const LITELLM_BODY = {
  data: [
    {
      model_name: "gpt-6-sol",
      litellm_params: { model: "openai/gpt-6-sol" },
      // Fully declared: the frozen Core v8 resolves identity against the
      // canonical registry (below) and publishes from registry facts.
      model_info: {
        mode: "responses",
        max_input_tokens: 100000,
        max_output_tokens: 10000,
        supports_function_calling: true,
        supports_reasoning: false,
        supports_vision: false,
        supports_pdf_input: false,
        supports_audio_input: false,
        supports_video_input: false,
        supports_audio_output: false,
      },
    },
  ],
}

/** Catalog shape ({ models, providers }): the frozen Core v8 era. */
const MODELS_DEV = {
  models: {
    "openai/gpt-6-sol": {
      limit: { context: 100000, output: 10000 },
      tool_call: true,
      reasoning: false,
      modalities: { input: ["text"], output: ["text"] },
      release_date: "2026-05-01",
    },
  },
  providers: {},
}

function fetchRouter(routes: Record<string, () => Response>): FetchLike {
  return async (input) => {
    const url = String(input)
    for (const [prefix, handler] of Object.entries(routes)) {
      if (url.startsWith(prefix)) return handler()
    }
    throw new Error(`unexpected URL ${url}`)
  }
}

const silent = { warn: () => {}, error: () => {} }

/** Core capability gate for version-divergent catalog expectations. */
const CORE_V8 = (PUBLICATION_SCHEMA_VERSION as number) === 8

/** LKG outage 用例的 catalog：v7 沿用 provider-map，v8 用 registry 补足的 shape。 */
const OUTAGE_CATALOG_V8 = {
  models: {
    "openai/gpt-6-sol": {
      limit: { context: 100000, output: 10000 },
      modalities: { input: ["text"], output: ["text"] },
      tool_call: true,
      reasoning: false,
    },
  },
  providers: {},
}

/** LKG outage 用例的 body：只声明 limits，有 catalog 可发布、无则缺口可见。 */
const OUTAGE_BODY = {
  data: [
    {
      model_name: "gpt-6-sol",
      litellm_params: { model: "openai/gpt-6-sol" },
      model_info: { mode: "responses", max_input_tokens: 100000, max_output_tokens: 10000 },
    },
  ],
}

function fakeContext(overrides: Record<string, unknown> = {}) {
  const published: unknown[] = []
  return {
    published,
    context: {
      signal: new AbortController().signal,
      credential: { type: "api_key", key: KEY },
      allowNetwork: true,
      publish: async (publication: { persist?: unknown }) => {
        if (publication.persist !== undefined) published.push(publication.persist)
        return true
      },
      ...overrides,
    },
  }
}

afterEach(resetModelsDevCacheForTest)

describe("discoverModels", () => {
  test("构建模型清单并映射为 pi 配置", async () => {
    const outcome = await discoverModels(config(), KEY, undefined, {
      fetchImpl: fetchRouter({
        [`${BASE}/v1/model/info`]: () => jsonResponse(200, LITELLM_BODY),
        "https://models.dev/catalog.json": () => jsonResponse(200, MODELS_DEV),
      }),
      logger: silent,
    })
    expect(outcome.models).toHaveLength(1)
    expect(outcome.models[0]).toMatchObject({
      id: "gpt-6-sol",
      api: "openai-responses",
      baseUrl: `${BASE}/v1`,
    })
    expect(outcome.fingerprint.length).toBeGreaterThan(0)
  })

  test("models.dev 失败时不伪装完整配置（空目录、模型保持 withheld）", async () => {
    // 该用例刻意只声明 limits：有 catalog 时记录补足（旧 Core）/ registry 补足
    // （新 Core）可发布；无 catalog 时缺口必须可见，不得注册。
    const limitsOnly = {
      data: [
        {
          model_name: "gpt-6-sol",
          litellm_params: { model: "openai/gpt-6-sol" },
          model_info: { mode: "responses", max_input_tokens: 100000, max_output_tokens: 10000 },
        },
      ],
    }
    const outcome = await discoverModels(config(), KEY, undefined, {
      fetchImpl: fetchRouter({
        [`${BASE}/v1/model/info`]: () => jsonResponse(200, limitsOnly),
        // getModelsDevCatalog degrades a 500 to an empty catalog with a warning.
        "https://models.dev/catalog.json": () => jsonResponse(500, {}),
      }),
      logger: silent,
    })
    // LiteLLM 只声明了 limits，tools/reasoning 无可信证据：不得注册
    // 看似正常的模型；缺口必须可见。
    expect(outcome.models).toHaveLength(0)
    expect(outcome.publication.withheld.map((model) => model.id)).toEqual(["gpt-6-sol"])
    expect(outcome.publication.withheld[0]!.reasons.map((reason) => reason.code)).toEqual([
      "metadata-unavailable",
    ])
  })

  test("元数据加载抛错时分类失败并可用有效 LKG 继续提供", async () => {
    const store = createLastKnownGoodStore()
    const catalog = CORE_V8 ? OUTAGE_CATALOG_V8 : MODELS_DEV
    const body = CORE_V8 ? OUTAGE_BODY : LITELLM_BODY
    const first = await discoverModels(config(), KEY, undefined, {
      fetchImpl: fetchRouter({
        [`${BASE}/v1/model/info`]: () => jsonResponse(200, body),
        "https://models.dev/catalog.json": () => jsonResponse(200, catalog),
      }),
      logger: silent,
      publication: { store },
    })
    expect(first.models.map((model) => model.id)).toEqual(["gpt-6-sol"])
    // v7 outage 保留旧用例（仅能力 flag，无 limits）；v8 outage 用与 capture
    // 相同的 limits-only 声明（modalities 缺口触发 LKG，declarations 不变）。
    const outageBody = CORE_V8 ? body : {
      data: [{
        model_name: "gpt-6-sol",
        litellm_params: { model: "openai/gpt-6-sol" },
        model_info: { mode: "responses", supports_function_calling: true, supports_reasoning: false },
      }],
    }
    const second = await discoverModels(config(), KEY, undefined, {
      fetchImpl: fetchRouter({
        [`${BASE}/v1/model/info`]: () => jsonResponse(200, outageBody),
      }),
      loadModelsDevCatalog: async () => {
        throw Object.assign(new Error("fetch failed"), { code: "ECONNREFUSED" })
      },
      logger: silent,
      publication: { store },
    })
    expect(second.publication.failureKind).toBe("unreachable")
    expect(second.models.map((model) => model.id)).toEqual(["gpt-6-sol"])
    expect(second.publication.lkgIDs).toEqual(["gpt-6-sol"])
  })
})

describe("refreshProviderModels 两阶段", () => {
  test("restore 阶段回放持久化清单且不发请求", async () => {
    let calls = 0
    const stored = {
      models: [storedModel("remembered")],
      snapshot: snapshotFor("remembered"),
      restoreFingerprint: restoreFingerprintFor(),
    }
    const models = await refreshProviderModels(
      config(),
      { allowNetwork: false, signal: new AbortController().signal, stored, publish: async () => true },
      {
        fetchImpl: async () => {
          calls += 1
          return jsonResponse(200, LITELLM_BODY)
        },
        logger: silent,
      },
    )
    expect(models.map((model) => model.id)).toEqual(["remembered"])
    expect(calls).toBe(0)
  })

  test("restore 阶段无持久化清单时返回空", async () => {
    const models = await refreshProviderModels(
      config(),
      { allowNetwork: false, signal: new AbortController().signal, publish: async () => true },
      { logger: silent },
    )
    expect(models).toEqual([])
  })

  test("显式 endpoint 不恢复同 URL/同凭据的 legacy snapshot", async () => {
    const stored = {
      models: [storedModel("remembered")],
      snapshot: snapshotFor("remembered"),
      restoreFingerprint: restoreFingerprintFor(),
    }
    const models = await refreshProviderModels(
      config({ endpointId: "company" }),
      { allowNetwork: false, signal: new AbortController().signal, stored, publish: async () => true },
      { logger: silent },
    )
    expect(models).toEqual([])
  })

  test("显式 endpoint 只恢复相同 endpoint identity 的 snapshot", async () => {
    const explicit = config({ endpointId: "company" })
    const stored = {
      models: [storedModel("remembered")],
      snapshot: snapshotFor("remembered", KEY, explicit),
      restoreFingerprint: restoreFingerprintFor(explicit),
    }
    const models = await refreshProviderModels(
      explicit,
      { allowNetwork: false, signal: new AbortController().signal, stored, publish: async () => true },
      { logger: silent },
    )
    expect(models.map((model) => model.id)).toEqual(["remembered"])
  })

  test("network 阶段成功发现并持久化", async () => {
    const { published, context } = fakeContext()
    const models = await refreshProviderModels(config(), context, {
      fetchImpl: fetchRouter({
        [`${BASE}/v1/model/info`]: () => jsonResponse(200, LITELLM_BODY),
        "https://models.dev/catalog.json": () => jsonResponse(200, MODELS_DEV),
      }),
      logger: silent,
    })
    expect(models.map((model) => model.id)).toEqual(["gpt-6-sol"])
    expect(published).toHaveLength(1)
    expect((published[0] as { models: unknown[] }).models).toHaveLength(1)
  })

  test("结果与持久化清单一致时不重复写入", async () => {
    const first = await discoverModels(config(), KEY, undefined, {
      fetchImpl: fetchRouter({
        [`${BASE}/v1/model/info`]: () => jsonResponse(200, LITELLM_BODY),
        "https://models.dev/catalog.json": () => jsonResponse(200, MODELS_DEV),
      }),
      logger: silent,
    })
    const storedSnapshot = createDiscoverySnapshot(
      endpointFingerprint({
        baseUrl: config().baseUrl,
        credentialKey: KEY,
        buildOptions: { contextTierCap: true, protocolOverrides: {} },
      }),
      first.specs,
      "2026-09-28T00:00:00.000Z",
    )
    const stored: { value: unknown } = {
      // A host that already persisted this round's publication memory (the
      // acknowledgement/baseline record) must not be written again.
      value: undefined,
    }
    const { published, context } = fakeContext({
      stored: undefined,
      publish: async (publication: { persist?: unknown }) => {
        if (publication.persist !== undefined) {
          published.push(publication.persist)
          stored.value = publication.persist
        }
        return true
      },
    })
    const firstRound = await refreshProviderModels(config(), context, {
      fetchImpl: fetchRouter({
        [`${BASE}/v1/model/info`]: () => jsonResponse(200, LITELLM_BODY),
        "https://models.dev/catalog.json": () => jsonResponse(200, MODELS_DEV),
      }),
      logger: silent,
    })
    expect(firstRound).toHaveLength(1)
    expect(published).toHaveLength(1)
    const persisted = published[0] as { models: unknown; snapshot?: unknown; publicationMemory?: unknown }
    expect(persisted.publicationMemory).toBeDefined()

    // Second round with the host state we just wrote: nothing new to persist.
    const publishedAgain: unknown[] = []
    const models = await refreshProviderModels(config(), {
      ...context,
      stored: persisted,
      publish: async (publication: { persist?: unknown }) => {
        if (publication.persist !== undefined) publishedAgain.push(publication.persist)
        return true
      },
    } as typeof context, {
      fetchImpl: fetchRouter({
        [`${BASE}/v1/model/info`]: () => jsonResponse(200, LITELLM_BODY),
        "https://models.dev/catalog.json": () => jsonResponse(200, MODELS_DEV),
      }),
      logger: silent,
    })
    expect(models).toHaveLength(1)
    expect(publishedAgain).toHaveLength(0)
  })
})


describe("publication memory persistence across restarts", () => {
  /** Endpoint metadata with no capability/limit evidence: always withheld. */
  const withheldBody = (names: string[]) => ({
    data: names.map((model_name) => ({
      model_name,
      litellm_params: { model: `custom/${model_name}` },
      model_info: { mode: "chat" },
    })),
  })

  function host() {
    const writes: Array<{ persist?: unknown }> = []
    let stored: unknown
    return {
      writes,
      context: {
        signal: new AbortController().signal,
        credential: { type: "api_key", key: KEY },
        allowNetwork: true,
        get stored() {
          return stored
        },
        publish: async (publication: { persist?: unknown }) => {
          if (publication.persist !== undefined) {
            writes.push(publication)
            stored = publication.persist
          }
          return true
        },
      } as unknown as RefreshModelsContextLike,
    }
  }

  const providerDeps = (body: () => unknown) => ({
    fetchImpl: fetchRouter({
      [`${BASE}/v1/model/info`]: () => jsonResponse(200, body()),
    }),
    loadModelsDevCatalog: async () => ({}),
    logger: silent,
  })

  test("an acknowledged problem set is not re-notified after a restart, and material change re-notifies", async () => {
    const { writes, context } = host()

    // Round 1 (process A): the endpoint is unusable -> surfaced and stored.
    const stateA = createProviderDiagnosticsState()
    const first = await refreshProviderModels(config(), context, providerDeps(() => withheldBody(["gap-a"])), undefined, stateA)
    expect(first).toEqual([])
    expect(takePendingNotice(stateA)?.reason).toBe("catalog-unusable")
    const persisted = writes.at(-1)!.persist as { publicationMemory?: unknown }
    const memory = persisted.publicationMemory as { acknowledgement: unknown; published: string[] }
    expect(memory.acknowledgement).not.toBeNull()
    expect(memory.published).toEqual([])

    // Round 2 (process B): a brand new controller restores from the persisted
    // payload and the identical problem set stays quiet.
    const stateB = createProviderDiagnosticsState()
    const again = await refreshProviderModels(config(), context, providerDeps(() => withheldBody(["gap-a"])), undefined, stateB)
    expect(again).toEqual([])
    expect(takePendingNotice(stateB)).toBeUndefined()
    expect(stateB.current.publication?.acknowledgement.notify).toBeFalse()
    expect(stateB.current.publication?.acknowledgement.reason).toBe("unchanged")

    // Round 3 (process C): a materially bigger problem set is surfaced again.
    const stateC = createProviderDiagnosticsState()
    await refreshProviderModels(config(), context, providerDeps(() => withheldBody(["gap-a", "gap-b"])), undefined, stateC)
    expect(takePendingNotice(stateC)?.reason).toBe("catalog-unusable")

    // Round 4 (process D): the recovered endpoint clears the acknowledgement.
    const stateD = createProviderDiagnosticsState()
    const recovered = await refreshProviderModels(
      config(),
      context,
      {
        fetchImpl: fetchRouter({
          [`${BASE}/v1/model/info`]: () => jsonResponse(200, LITELLM_BODY),
          "https://models.dev/catalog.json": () => jsonResponse(200, MODELS_DEV),
        }),
        logger: silent,
      },
      undefined,
      stateD,
    )
    expect(recovered.map((model) => model.id)).toEqual(["gpt-6-sol"])
    const cleared = (writes.at(-1)!.persist as { publicationMemory?: { acknowledgement: unknown; published: string[] } })
      .publicationMemory!
    expect(cleared.acknowledgement).toBeNull()
    expect(cleared.published).toEqual(["gpt-6-sol"])
  })

  test("unreadable persisted memory is inert: it never suppresses and never blocks publication", async () => {
    const { context } = host()
    const state = createProviderDiagnosticsState()
    const corrupted = {
      ...context,
      stored: {
        models: [],
        checkedAt: 1,
        publicationMemory: { schemaVersion: 99, acknowledgement: { nonsense: true }, published: 5 },
      },
    } as unknown as RefreshModelsContextLike
    const models = await refreshProviderModels(config(), corrupted, {
      fetchImpl: fetchRouter({
        [`${BASE}/v1/model/info`]: () => jsonResponse(200, LITELLM_BODY),
        "https://models.dev/catalog.json": () => jsonResponse(200, MODELS_DEV),
      }),
      logger: silent,
    }, undefined, state)
    // Publication is decided by Core alone: the corrupt memory changes nothing.
    expect(models.map((model) => model.id)).toEqual(["gpt-6-sol"])
    expect(state.current.publication?.publishable.map((entry) => entry.id)).toEqual(["gpt-6-sol"])
  })
})

describe("refreshProviderModels 失败分类", () => {
  test("未连接地址时返回空且不发请求，并记录说明性提示", async () => {
    let calls = 0
    const warnings: string[] = []
    const { published, context } = fakeContext()
    const models = await refreshProviderModels(config({ baseUrl: "" }), context, {
      fetchImpl: async () => {
        calls += 1
        return jsonResponse(200, LITELLM_BODY)
      },
      logger: { warn: (message) => warnings.push(message), error: () => {} },
    })
    expect(models).toEqual([])
    expect(calls).toBe(0)
    expect(warnings.some((message) => message.includes("未配置地址"))).toBeTrue()
    expect(published).toHaveLength(1)
  })

  test("未连接时连续两次相同空结果只持久化一次", async () => {
    let stored: ProviderModelConfigLike[] | undefined
    let publishCount = 0
    const warnings: string[] = []
    const makeContext = () => ({
      signal: new AbortController().signal,
      credential: { type: "api_key", key: KEY },
      allowNetwork: true,
      get stored() {
        return stored ? { models: stored } : undefined
      },
      publish: async (publication: { persist?: unknown }) => {
        const persist = publication.persist as { models: ProviderModelConfigLike[] } | undefined
        if (persist) {
          publishCount += 1
          stored = persist.models
        }
        return true
      },
    })
    const deps = { logger: { warn: (m: string) => warnings.push(m), error: () => {} } }
    const emptyConfig = config({ baseUrl: "" })
    await refreshProviderModels(emptyConfig, makeContext(), deps)
    await refreshProviderModels(emptyConfig, makeContext(), deps)
    // First call persisted []; second sees an identical stored [] and skips the write.
    expect(publishCount).toBe(1)
    expect(stored).toEqual([])
    expect(warnings.filter((message) => message.includes("未配置地址"))).toHaveLength(2)
  })

  test("缺少凭据时返回空且不发请求", async () => {
    let calls = 0
    const { context } = fakeContext({ credential: undefined })
    const models = await refreshProviderModels(config(), context, {
      fetchImpl: async () => {
        calls += 1
        return jsonResponse(200, LITELLM_BODY)
      },
      logger: silent,
    })
    expect(models).toEqual([])
    expect(calls).toBe(0)
  })

  test("401/403 撤下模型并持久化空清单", async () => {
    const { published, context } = fakeContext({ stored: { models: [storedModel("old")] } })
    const models = await refreshProviderModels(config(), context, {
      fetchImpl: fetchRouter({ [`${BASE}/v1/model/info`]: () => jsonResponse(401, {}) }),
      logger: silent,
    })
    expect(models).toEqual([])
    expect(published).toHaveLength(1)
    expect((published[0] as { models: unknown[] }).models).toEqual([])
  })

  test("连续两次相同 401 空结果只持久化一次", async () => {
    let stored: ProviderModelConfigLike[] | undefined
    let publishCount = 0
    const contextFor = (): RefreshModelsContextLike => ({
      signal: new AbortController().signal,
      credential: { type: "api_key", key: KEY },
      allowNetwork: true,
      get stored() {
        return stored ? { models: stored } : undefined
      },
      publish: async (publication: { persist?: unknown }) => {
        const persist = publication.persist as { models: ProviderModelConfigLike[] } | undefined
        if (persist) {
          publishCount += 1
          stored = persist.models
        }
        return true
      },
    })
    const deps = {
      fetchImpl: fetchRouter({ [`${BASE}/v1/model/info`]: () => jsonResponse(401, {}) }),
      logger: silent,
    }
    await refreshProviderModels(config(), contextFor(), deps)
    await refreshProviderModels(config(), contextFor(), deps)
    expect(publishCount).toBe(1)
  })

  test("非 http(s) 地址按配置错误处理：error 级、不发请求、撤下模型", async () => {
    let calls = 0
    const errors: string[] = []
    const warnings: string[] = []
    const { published, context } = fakeContext({ stored: { models: [storedModel("old")] } })
    const models = await refreshProviderModels(config({ baseUrl: "ftp://litellm.example" }), context, {
      fetchImpl: async () => {
        calls += 1
        return jsonResponse(200, LITELLM_BODY)
      },
      logger: { warn: (message) => warnings.push(message), error: (message) => errors.push(message) },
    })
    expect(models).toEqual([])
    expect(calls).toBe(0)
    expect(errors.some((message) => message.includes("地址无效"))).toBeTrue()
    // m2: configuration errors must not carry the transport-failure prefix.
    expect(warnings.some((message) => message.includes("保留上次结果"))).toBeFalse()
    // Address unusable → stale models dropped and persisted as empty.
    expect(published).toHaveLength(1)
    expect((published[0] as { models: unknown[] }).models).toEqual([])
  })

  test("已采用的地址无法规范化（含用户信息）按 error 级处理（spec scenario）", async () => {
    // This is the production path that reaches the error tier: userinfo addresses pass
    // a plain http(s) check in config, then normalizeLiteLLMURL rejects them.
    let calls = 0
    const errors: string[] = []
    const { published, context } = fakeContext({ stored: { models: [storedModel("old")] } })
    const models = await refreshProviderModels(
      config({ baseUrl: "http://user:pass@litellm.example:4000" }),
      context,
      {
        fetchImpl: async () => {
          calls += 1
          return jsonResponse(200, LITELLM_BODY)
        },
        logger: { warn: () => {}, error: (message) => errors.push(message) },
      },
    )
    expect(models).toEqual([])
    expect(calls).toBe(0)
    expect(errors.some((message) => message.includes("地址无效"))).toBeTrue()
    expect(published).toHaveLength(1)
    expect((published[0] as { models: unknown[] }).models).toEqual([])
  })

  test("网络错误抛出以保留宿主旧清单", async () => {
    const { published, context } = fakeContext()
    await expect(
      refreshProviderModels(config(), context, {
        fetchImpl: async () => {
          throw new Error("connection refused")
        },
        logger: silent,
      }),
    ).rejects.toMatchObject({ kind: "network" })
    expect(published).toHaveLength(0)
  })

  test("5xx 抛出", async () => {
    const { context } = fakeContext()
    await expect(
      refreshProviderModels(config(), context, {
        fetchImpl: fetchRouter({ [`${BASE}/v1/model/info`]: () => jsonResponse(503, {}) }),
        logger: silent,
      }),
    ).rejects.toMatchObject({ kind: "server" })
  })

  test("429 抛出", async () => {
    const { context } = fakeContext()
    await expect(
      refreshProviderModels(config(), context, {
        fetchImpl: fetchRouter({ [`${BASE}/v1/model/info`]: () => jsonResponse(429, {}) }),
        logger: silent,
      }),
    ).rejects.toMatchObject({ kind: "ratelimit" })
  })

  test("404 先回退 /model/info，仍失败则抛出", async () => {
    const urls: string[] = []
    const { context } = fakeContext()
    await expect(
      refreshProviderModels(config(), context, {
        fetchImpl: async (input) => {
          urls.push(String(input))
          return jsonResponse(404, {})
        },
        logger: silent,
      }),
    ).rejects.toMatchObject({ kind: "notfound" })
    expect(urls).toEqual([`${BASE}/v1/model/info`, `${BASE}/model/info`])
  })

  test("成功空清单撤下模型并持久化", async () => {
    const { published, context } = fakeContext({ stored: { models: [storedModel("old")] } })
    const models = await refreshProviderModels(config(), context, {
      fetchImpl: fetchRouter({
        [`${BASE}/v1/model/info`]: () => jsonResponse(200, { data: [] }),
        "https://models.dev/catalog.json": () => jsonResponse(200, MODELS_DEV),
      }),
      logger: silent,
    })
    expect(models).toEqual([])
    expect(published).toHaveLength(1)
    expect((published[0] as { models: unknown[] }).models).toEqual([])
  })

  test("已中止的 signal 在 network 阶段直接回放持久化清单", async () => {
    const controller = new AbortController()
    controller.abort()
    const stored = { models: [storedModel("remembered")], snapshot: snapshotFor("remembered") }
    const { context } = fakeContext({ signal: controller.signal, stored })
    const models = await refreshProviderModels(config(), context, { logger: silent })
    expect(models.map((model) => model.id)).toEqual(["remembered"])
  })

  test("持久化失败不影响本次结果", async () => {
    const { context } = fakeContext({
      publish: async () => {
        throw new Error("disk full")
      },
    })
    const models = await refreshProviderModels(config(), context, {
      fetchImpl: fetchRouter({
        [`${BASE}/v1/model/info`]: () => jsonResponse(200, LITELLM_BODY),
        "https://models.dev/catalog.json": () => jsonResponse(200, MODELS_DEV),
      }),
      logger: silent,
    })
    expect(models.map((model) => model.id)).toEqual(["gpt-6-sol"])
  })

  test("真实持久化失败仍记录警告（console.warn）", async () => {
    const captured: string[] = []
    const originalWarn = console.warn
    console.warn = (message: unknown) => captured.push(String(message))
    try {
      const { context } = fakeContext({
        publish: async () => {
          throw new Error("ENOSPC: no space left on device")
        },
      })
      await refreshProviderModels(config(), context, {
        fetchImpl: fetchRouter({
          [`${BASE}/v1/model/info`]: () => jsonResponse(200, LITELLM_BODY),
          "https://models.dev/catalog.json": () => jsonResponse(200, MODELS_DEV),
        }),
        logger: silent,
      })
    } finally {
      console.warn = originalWarn
    }
    expect(captured.some((message) => message.includes("目录持久化失败"))).toBeTrue()
  })

  test("host 取消（网络阶段中止）静默回放清单：不告警、不抛错、不持久化", async () => {
    const controller = new AbortController()
    const warns: string[] = []
    const errors: string[] = []
    const { published, context } = fakeContext({
      signal: controller.signal,
      stored: { models: [storedModel("remembered")], snapshot: snapshotFor("remembered") },
    })
    const deps = {
      fetchImpl: ((_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          // The host cancels this refresh while the LiteLLM request is in flight
          // (supersede by a newer refresh, 15s catalog timeout, or shutdown).
          queueMicrotask(() => controller.abort())
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("This operation was aborted", "AbortError")),
            { once: true },
          )
        })) as FetchLike,
      logger: { warn: (message: string) => warns.push(message), error: (message: string) => errors.push(message) },
    }

    const models = await refreshProviderModels(config(), context, deps)
    // Cancellation is not a failure: replay the persisted baseline, log nothing, do not write.
    expect(models.map((model) => model.id)).toEqual(["remembered"])
    expect(warns).toEqual([])
    expect(errors).toEqual([])
    expect(published).toHaveLength(0)
  })

  test("持久化写入被取消竞态打断时静默（发布结果仍返回）", async () => {
    const controller = new AbortController()
    const warns: string[] = []
    const context = fakeContext().context as Parameters<typeof refreshProviderModels>[1]
    const racingContext: typeof context = {
      ...context,
      signal: controller.signal,
      publish: async () => {
        // Cancellation lands while the store write is in flight.
        controller.abort()
        throw new DOMException("This operation was aborted", "AbortError")
      },
    }

    const models = await refreshProviderModels(config(), racingContext, {
      fetchImpl: fetchRouter({
        [`${BASE}/v1/model/info`]: () => jsonResponse(200, LITELLM_BODY),
        "https://models.dev/catalog.json": () => jsonResponse(200, MODELS_DEV),
      }),
      logger: { warn: (message: string) => warns.push(message), error: () => {} },
    })
    expect(models.map((model) => model.id)).toEqual(["gpt-6-sol"])
    expect(warns.filter((message) => message.includes("持久化失败"))).toEqual([])
  })
})
