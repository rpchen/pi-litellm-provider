import { readFileSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { normalizeModelsDevCatalog } from "../core/index.ts"
/**
 * Host-independent HTTP fetching with timeout, error classification and key redaction.
 *
 * Pi-side network adapter for the independent discovery core. The optional external
 * AbortSignal is combined with the per-request timeout, so pi's
 * `refreshModels(context.signal)` cancellation reaches in-flight discovery requests.
 * No pi or OpenCode imports allowed in this directory.
 */
import type { LiteLLMAddresses } from "../core/index.ts"

export type DiscoveryErrorKind =
  | "network"
  | "auth"
  | "notfound"
  | "ratelimit"
  | "server"
  | "parse"
  | "redirect"

export class DiscoveryError extends Error {
  constructor(
    readonly kind: DiscoveryErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = "DiscoveryError"
  }
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface FetchJSONOptions {
  url: string
  key?: string
  timeoutMs: number
  fetchImpl?: FetchLike
  /** External cancellation (e.g. pi's refresh signal); aborts the request alongside the timeout. */
  signal?: AbortSignal
}

export interface CacheLogger {
  warn(message: string): void
}

const MODELS_DEV_URL = "https://models.dev/catalog.json"
const MODELS_DEV_RETRY_MS = 60 * 1000

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function safeURL(raw: string): string {
  try {
    const url = new URL(raw)
    url.username = ""
    url.password = ""
    return url.toString()
  } catch {
    return raw.replace(/\/\/[^/@\s]+@/g, "//***@")
  }
}

export function redact(value: string, key?: string): string {
  let output = value
  if (key) output = output.replace(new RegExp(escapeRegExp(key), "g"), "sk-***")
  output = output.replace(/sk-[A-Za-z0-9_-]+/g, "sk-***")
  return output
}

function statusError(url: string, status: number, key?: string): DiscoveryError {
  const safe = redact(safeURL(url), key)
  if (status >= 300 && status < 400) {
    return new DiscoveryError("redirect", `请求 ${safe} 返回重定向状态 ${status}，请检查 LiteLLM 地址`, status)
  }
  if (status === 401 || status === 403) {
    return new DiscoveryError("auth", `请求 ${safe} 返回 ${status}：Key 无效或无权限`, status)
  }
  if (status === 404) return new DiscoveryError("notfound", `请求 ${safe} 返回 404`, status)
  if (status === 429) return new DiscoveryError("ratelimit", `请求 ${safe} 返回 429`, status)
  if (status >= 500) return new DiscoveryError("server", `请求 ${safe} 返回服务器错误 ${status}`, status)
  return new DiscoveryError("network", `请求 ${safe} 返回 HTTP ${status}`, status)
}

export async function fetchJSON(options: FetchJSONOptions): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs)
  const fetchImpl = options.fetchImpl ?? fetch
  const external = options.signal

  const onExternalAbort = () => controller.abort()
  if (external) {
    if (external.aborted) controller.abort()
    else external.addEventListener("abort", onExternalAbort, { once: true })
  }

  try {
    const response = await fetchImpl(options.url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: options.key ? { Authorization: `Bearer ${options.key}` } : undefined,
    })
    if (!response.ok) throw statusError(options.url, response.status, options.key)

    try {
      return await response.json()
    } catch {
      throw new DiscoveryError(
        "parse",
        `请求 ${redact(safeURL(options.url), options.key)} 的响应不是有效 JSON`,
        response.status,
      )
    }
  } catch (error) {
    if (error instanceof DiscoveryError) throw error
    const externalAborted = external?.aborted === true
    const timedOut = !externalAborted && controller.signal.aborted
    const detail = error instanceof Error ? error.message : String(error)
    const reason = externalAborted ? "请求已取消" : timedOut ? "请求超时" : redact(detail, options.key)
    throw new DiscoveryError("network", `${reason}：${redact(safeURL(options.url), options.key)}`)
  } finally {
    clearTimeout(timeout)
    if (external && !external.aborted) external.removeEventListener("abort", onExternalAbort)
  }
}

export async function fetchLiteLLMModelInfo(
  addresses: LiteLLMAddresses,
  key: string,
  fetchImpl?: FetchLike,
  signal?: AbortSignal,
): Promise<unknown> {
  try {
    return await fetchJSON({ url: addresses.modelInfoURL, key, timeoutMs: 15_000, fetchImpl, signal })
  } catch (error) {
    if (!(error instanceof DiscoveryError) || error.kind !== "notfound") throw error
    return fetchJSON({ url: addresses.legacyModelInfoURL, key, timeoutMs: 15_000, fetchImpl, signal })
  }
}

interface CatalogCache {
  cachePath?: string
  value?: unknown
  retryAt: number
  pending?: Promise<unknown>
}

const catalogCaches = new Map<string, CatalogCache>()

export interface ModelsDevOptions {
  /** Override disk location for isolated consumers/tests; false disables persistence. */
  cachePath?: string | false
  fetchImpl?: FetchLike
  now?: () => number
  logger?: CacheLogger
  url?: string
  signal?: AbortSignal
  /** Read the successful local snapshot without starting a request. */
  cachedOnly?: boolean
  /** Bypass the successful local snapshot and ask for the latest catalog. */
  forceRefresh?: boolean
}

export async function getModelsDevCatalog(options: ModelsDevOptions = {}): Promise<unknown | undefined> {
  const url = options.url ?? MODELS_DEV_URL
  // Injected transports are isolated unless persistence is explicitly requested.
  const cachePath = options.cachePath === false ? undefined : options.cachePath ??
    (options.fetchImpl ? undefined : join(homedir(), ".cache", "litellm-provider", "models-dev",
      createHash("sha256").update(url).digest("hex") + ".json"))
  const cacheKey = JSON.stringify([url, cachePath])
  let existingCache = catalogCaches.get(cacheKey)
  if (!existingCache) {
    existingCache = { retryAt: 0, cachePath }
    if (cachePath) {
      try {
        const saved = JSON.parse(readFileSync(cachePath, "utf8"))
        if (saved.url === url && normalizeModelsDevCatalog(saved.catalog).kind === "complete") {
          existingCache.value = saved.catalog
        }
      } catch { /* Missing or unreadable cache is a cold start. */ }
    }
    catalogCaches.set(cacheKey, existingCache)
  }
  const catalogCache = existingCache
  const now = options.now?.() ?? Date.now()
  if (!options.forceRefresh && catalogCache.value !== undefined) return catalogCache.value
  if (options.cachedOnly) return undefined
  if (now < catalogCache.retryAt) return {}
  if (catalogCache.pending) return catalogCache.pending

  const request = fetchJSON({
    url,
    timeoutMs: 60_000,
    fetchImpl: options.fetchImpl,
    signal: options.signal,
  })
    .then((value) => {
      if (normalizeModelsDevCatalog(value).kind !== "complete" && normalizeModelsDevCatalog(catalogCache.value).kind === "complete") {
        return value
      }
      catalogCache.value = value
      catalogCache.retryAt = 0
      if (cachePath && normalizeModelsDevCatalog(value).kind === "complete") {
        try {
          mkdirSync(dirname(cachePath), { recursive: true })
          const temporary = cachePath + "." + randomUUID() + ".tmp"
          writeFileSync(temporary, JSON.stringify({ url, catalog: value }), { mode: 0o600 })
          renameSync(temporary, cachePath)
        } catch { /* Disk cache is best effort; successful discovery still works. */ }
      }
      return value
    })
    .catch((error: unknown) => {
      // A host-cancelled refresh aborts this fetch too: degrade silently without
      // touching the cache state or poisoning the retry backoff (whatever a previous
      // real failure scheduled still holds; the next refresh fetches normally).
      if (options.signal?.aborted) {
        return catalogCache.value ?? {}
      }
      const failedAt = options.now?.() ?? Date.now()
      catalogCache.retryAt = failedAt + MODELS_DEV_RETRY_MS
      const message = error instanceof Error ? error.message : String(error)
      options.logger?.warn(`models.dev 获取失败，暂不补充模型元数据：${redact(message)}`)
      return {}
    })
    .finally(() => {
      catalogCache.pending = undefined
    })

  catalogCache.pending = request
  return request
}

export function resetModelsDevCacheForTest(clearDisk = false): void {
  if (clearDisk) {
    for (const cache of catalogCaches.values()) {
      if (cache.cachePath) {
        try { unlinkSync(cache.cachePath) } catch { /* Test cache may already be absent. */ }
      }
    }
  }
  catalogCaches.clear()
}
