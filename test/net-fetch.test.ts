import { afterEach, describe, expect, test } from "bun:test"
import { normalizeLiteLLMURL } from "../src/core/litellm.ts"
import {
  DiscoveryError,
  fetchJSON,
  fetchLiteLLMModelInfo,
  getModelsDevCatalog,
  redact,
  resetModelsDevCacheForTest,
  type FetchLike,
} from "../src/net/fetch.ts"

const KEY = "sk-secret-value"

function response(status: number, body = "{}") {
  return new Response(body, { status, headers: { "content-type": "application/json" } })
}

async function errorKind(status: number) {
  const fetchImpl: FetchLike = async () => response(status)
  try {
    await fetchJSON({ url: "https://litellm.example/v1/model/info", key: KEY, timeoutMs: 100, fetchImpl })
  } catch (error) {
    return error as DiscoveryError
  }
  throw new Error("预期请求失败")
}

describe("fetchJSON", () => {
  test.each([
    [401, "auth"],
    [403, "auth"],
    [404, "notfound"],
    [429, "ratelimit"],
    [500, "server"],
    [302, "redirect"],
  ] as const)("把状态 %s 分类为 %s", async (status, kind) => {
    expect((await errorKind(status)).kind).toBe(kind)
  })

  test("网络错误与解析错误分类", async () => {
    const network: FetchLike = async () => {
      throw new Error(`连接失败 ${KEY}`)
    }
    await expect(
      fetchJSON({ url: "https://litellm.example", key: KEY, timeoutMs: 100, fetchImpl: network }),
    ).rejects.toMatchObject({ kind: "network" })

    const invalid: FetchLike = async () => response(200, "private response body")
    await expect(
      fetchJSON({ url: "https://litellm.example", key: KEY, timeoutMs: 100, fetchImpl: invalid }),
    ).rejects.toMatchObject({ kind: "parse" })
  })

  test("错误信息不含 Key 或响应体", async () => {
    const invalid: FetchLike = async () => response(200, `private body ${KEY}`)
    try {
      await fetchJSON({ url: `https://user:${KEY}@litellm.example`, key: KEY, timeoutMs: 100, fetchImpl: invalid })
    } catch (error) {
      const message = (error as Error).message
      expect(message).not.toContain(KEY)
      expect(message).not.toContain("private body")
      expect(message).toContain("litellm.example")
    }
    expect(redact(`token=${KEY}`, KEY)).toBe("token=sk-***")
  })

  test("请求设置手动重定向并以 Bearer 携带 Key", async () => {
    let init: RequestInit | undefined
    const fetchImpl: FetchLike = async (_input, received) => {
      init = received
      return response(200, '{"data":[]}')
    }
    await fetchJSON({ url: "https://litellm.example", key: KEY, timeoutMs: 100, fetchImpl })
    expect(init?.redirect).toBe("manual")
    expect(init?.headers).toEqual({ Authorization: `Bearer ${KEY}` })
  })

  test("外部 signal 中止请求", async () => {
    const controller = new AbortController()
    const hanging: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
      })
    const request = fetchJSON({
      url: "https://litellm.example",
      key: KEY,
      timeoutMs: 5_000,
      fetchImpl: hanging,
      signal: controller.signal,
    })
    controller.abort()
    await expect(request).rejects.toMatchObject({ kind: "network" })
  })

  test("已中止的 signal 立即失败", async () => {
    const controller = new AbortController()
    controller.abort()
    const never: FetchLike = async () => {
      throw new Error("should not be called with an aborted signal")
    }
    await expect(
      fetchJSON({ url: "https://litellm.example", key: KEY, timeoutMs: 100, fetchImpl: never, signal: controller.signal }),
    ).rejects.toMatchObject({ kind: "network" })
  })
})

describe("fetchLiteLLMModelInfo", () => {
  test("/v1/model/info 为 404 时回退 /model/info", async () => {
    const urls: string[] = []
    const fetchImpl: FetchLike = async (input) => {
      urls.push(String(input))
      return urls.length === 1 ? response(404) : response(200, '{"data":[]}')
    }
    const result = await fetchLiteLLMModelInfo(normalizeLiteLLMURL("https://litellm.example"), KEY, fetchImpl)
    expect(result).toEqual({ data: [] })
    expect(urls).toEqual([
      "https://litellm.example/v1/model/info",
      "https://litellm.example/model/info",
    ])
  })

  test("认证失败不回退", async () => {
    const urls: string[] = []
    const fetchImpl: FetchLike = async (input) => {
      urls.push(String(input))
      return response(401)
    }
    await expect(
      fetchLiteLLMModelInfo(normalizeLiteLLMURL("https://litellm.example"), KEY, fetchImpl),
    ).rejects.toMatchObject({ kind: "auth" })
    expect(urls).toHaveLength(1)
  })
})

describe("models.dev 缓存", () => {
  afterEach(resetModelsDevCacheForTest)

  test("成功结果缓存 6 小时", async () => {
    let calls = 0
    let now = 1_000
    const fetchImpl: FetchLike = async () => {
      calls += 1
      return response(200, '{"openai":{}}')
    }
    const options = { fetchImpl, now: () => now }
    expect(await getModelsDevCatalog(options)).toEqual({ openai: {} })
    now += 6 * 60 * 60 * 1000 - 1
    expect(await getModelsDevCatalog(options)).toEqual({ openai: {} })
    expect(calls).toBe(1)
  })

  test("失败返回空目录，退避期内不重复请求", async () => {
    let calls = 0
    let now = 2_000
    const warnings: string[] = []
    const fetchImpl: FetchLike = async () => {
      calls += 1
      throw new Error("offline")
    }
    const options = { fetchImpl, now: () => now, logger: { warn: (message: string) => warnings.push(message) } }
    expect(await getModelsDevCatalog(options)).toEqual({})
    now += 59_999
    expect(await getModelsDevCatalog(options)).toEqual({})
    expect(calls).toBe(1)
    expect(warnings).toHaveLength(1)
  })

  test("退避期过后重试并恢复", async () => {
    let calls = 0
    let now = 3_000
    let failing = true
    const fetchImpl: FetchLike = async () => {
      calls += 1
      if (failing) throw new Error("offline")
      return response(200, '{"anthropic":{}}')
    }
    const options = { fetchImpl, now: () => now }
    expect(await getModelsDevCatalog(options)).toEqual({})
    now += 60_000
    failing = false
    expect(await getModelsDevCatalog(options)).toEqual({ anthropic: {} })
    expect(calls).toBe(2)
  })

  test("signal 中止的请求静默降级，且不设退避", async () => {
    const controller = new AbortController()
    controller.abort()
    const warnings: string[] = []
    const logger = { warn: (message: string) => warnings.push(message) }

    const abortedFetch: FetchLike = async (_input, init) => {
      if (init?.signal?.aborted) throw new DOMException("This operation was aborted", "AbortError")
      return response(200, '{"never":{}}')
    }
    const degraded = await getModelsDevCatalog({ fetchImpl: abortedFetch, signal: controller.signal, logger })
    expect(degraded).toEqual({})
    expect(warnings).toEqual([])

    // The abort must not have scheduled a retry backoff: the very next fetch proceeds.
    let okCalls = 0
    const okFetch: FetchLike = async () => {
      okCalls += 1
      return response(200, '{"openai":{}}')
    }
    const recovered = await getModelsDevCatalog({ fetchImpl: okFetch, signal: new AbortController().signal, logger })
    expect(recovered).toEqual({ openai: {} })
    expect(okCalls).toBe(1)
    expect(warnings).toEqual([])
  })
})
