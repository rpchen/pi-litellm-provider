import { afterEach, describe, expect, test } from "bun:test"
import { discoverModels, refreshProviderModels } from "../src/extension/discovery.ts"
import { DEFAULT_POLL_INTERVAL_SECONDS, type ExtensionConfig } from "../src/extension/config.ts"
import { resetModelsDevCacheForTest, type FetchLike } from "../src/net/fetch.ts"
import type { ProviderModelConfigLike } from "../src/extension/types.ts"

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
      model_info: { mode: "responses", max_input_tokens: 100000, max_output_tokens: 10000 },
    },
  ],
}

const MODELS_DEV = {
  openai: {
    models: { "gpt-6-sol": { id: "gpt-6-sol", release_date: "2026-05-01" } },
  },
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
        "https://models.dev/api.json": () => jsonResponse(200, MODELS_DEV),
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

  test("models.dev 失败时降级为仅 LiteLLM 数据", async () => {
    const outcome = await discoverModels(config(), KEY, undefined, {
      fetchImpl: fetchRouter({
        [`${BASE}/v1/model/info`]: () => jsonResponse(200, LITELLM_BODY),
        "https://models.dev/api.json": () => jsonResponse(500, {}),
      }),
      logger: silent,
    })
    expect(outcome.models).toHaveLength(1)
  })
})

describe("refreshProviderModels 两阶段", () => {
  test("restore 阶段回放持久化清单且不发请求", async () => {
    let calls = 0
    const stored = { models: [storedModel("remembered")] }
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

  test("network 阶段成功发现并持久化", async () => {
    const { published, context } = fakeContext()
    const models = await refreshProviderModels(config(), context, {
      fetchImpl: fetchRouter({
        [`${BASE}/v1/model/info`]: () => jsonResponse(200, LITELLM_BODY),
        "https://models.dev/api.json": () => jsonResponse(200, MODELS_DEV),
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
        "https://models.dev/api.json": () => jsonResponse(200, MODELS_DEV),
      }),
      logger: silent,
    })
    const { published, context } = fakeContext({ stored: { models: first.models } })
    const models = await refreshProviderModels(config(), context, {
      fetchImpl: fetchRouter({
        [`${BASE}/v1/model/info`]: () => jsonResponse(200, LITELLM_BODY),
        "https://models.dev/api.json": () => jsonResponse(200, MODELS_DEV),
      }),
      logger: silent,
    })
    expect(models).toHaveLength(1)
    expect(published).toHaveLength(0)
  })
})

describe("refreshProviderModels 失败分类", () => {
  test("未连接地址时返回空且不发请求", async () => {
    let calls = 0
    const { published, context } = fakeContext()
    const models = await refreshProviderModels(config({ baseUrl: "" }), context, {
      fetchImpl: async () => {
        calls += 1
        return jsonResponse(200, LITELLM_BODY)
      },
      logger: silent,
    })
    expect(models).toEqual([])
    expect(calls).toBe(0)
    expect(published).toHaveLength(1)
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
        "https://models.dev/api.json": () => jsonResponse(200, MODELS_DEV),
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
    const stored = { models: [storedModel("remembered")] }
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
        "https://models.dev/api.json": () => jsonResponse(200, MODELS_DEV),
      }),
      logger: silent,
    })
    expect(models.map((model) => model.id)).toEqual(["gpt-6-sol"])
  })
})
