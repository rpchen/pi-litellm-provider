/**
 * Discovery entry point behind pi's `refreshModels`.
 *
 * Implements design D5/D6:
 *  - restore phase (`allowNetwork` false) replays the host-persisted catalog
 *  - network phase performs real discovery and persists the result via `publish`
 *  - failure classification: network/parse/redirect/ratelimit/server/404-exhausted throw
 *    (host keeps the last good catalog); 401/403 and "not connected" return an empty list
 *  - successful results (including empty ones) are persisted so removals survive restarts
 *
 * The API key comes from the host-resolved credential when present, falling back to the
 * host's own `apiKey` reference resolution (which we cannot observe here). A missing key
 * is treated as "not configured": no network request, empty list.
 */
import { buildModelSpecs, modelFingerprint, type ModelSpec } from "../core/build.ts"
import { normalizeLiteLLMURL } from "../core/litellm.ts"
import { DiscoveryError, fetchLiteLLMModelInfo, getModelsDevCatalog, type FetchLike } from "../net/fetch.ts"
import type { ExtensionConfig } from "./config.ts"
import { toProviderModels } from "./map.ts"
import type { ProviderModelConfigLike, RefreshModelsContextLike } from "./types.ts"

export interface DiscoveryLogger {
  warn(message: string): void
  error(message: string): void
}

export interface DiscoveryDeps {
  fetchImpl?: FetchLike
  logger?: DiscoveryLogger
  /** Override models.dev catalog source (tests); production uses the shared cache. */
  loadModelsDevCatalog?: (signal?: AbortSignal) => Promise<unknown>
}

/** Result of one network-phase discovery, before persistence. */
export interface DiscoveryOutcome {
  models: ProviderModelConfigLike[]
  specs: ModelSpec[]
  fingerprint: string
}

/** Persisted payload shape; the host stores it verbatim and replays it in restore phase. */
interface PersistedCatalog {
  models: ProviderModelConfigLike[]
  checkedAt: number
}

/**
 * Run the network phase: contact LiteLLM, enrich from models.dev, build specs and map to
 * pi provider configs. Throws `DiscoveryError` on degradable failures.
 */
export async function discoverModels(
  config: ExtensionConfig,
  apiKey: string,
  signal: AbortSignal | undefined,
  deps: DiscoveryDeps = {},
): Promise<DiscoveryOutcome> {
  const addresses = normalizeLiteLLMURL(config.baseUrl)
  const litellmResponse = await fetchLiteLLMModelInfo(addresses, apiKey, deps.fetchImpl, signal)
  const catalog = deps.loadModelsDevCatalog
    ? await deps.loadModelsDevCatalog(signal)
    : await getModelsDevCatalog({ fetchImpl: deps.fetchImpl, logger: deps.logger, signal })
  const specs = buildModelSpecs(litellmResponse, catalog, {
    contextTierCap: config.contextTierCap,
    protocolOverrides: config.protocolOverrides,
  })
  return {
    specs,
    models: toProviderModels(specs, addresses.rootURL),
    fingerprint: modelFingerprint(specs),
  }
}

/**
 * `refreshModels` callback body.
 *
 * Returns the model list the host should register for this provider. See the module
 * comment for the phase/failure semantics.
 */
export async function refreshProviderModels(
  config: ExtensionConfig,
  context: RefreshModelsContextLike,
  deps: DiscoveryDeps = {},
): Promise<ProviderModelConfigLike[]> {
  const logger = deps.logger ?? console
  const stored = asStoredCatalog(context.stored)

  // Restore phase, or an aborted request: replay whatever the host persisted last.
  if (context.allowNetwork === false || context.signal?.aborted) {
    return stored?.models ?? []
  }

  // Not connected: no address resolved. Clear the catalog so stale models disappear.
  if (config.baseUrl.length === 0) {
    await publish(context, [])
    return []
  }

  const apiKey = context.credential?.key
  if (!apiKey) {
    // The host only reaches the network phase when a credential resolved; treat a missing
    // key defensively as unconfigured rather than sending an unauthenticated request.
    logger.warn("LiteLLM Key 未配置，跳过发现（请使用 /login 或设置 LITELLM_API_KEY）")
    await publish(context, [])
    return []
  }

  try {
    const outcome = await discoverModels(config, apiKey, context.signal, deps)
    if (modelsFingerprint(stored?.models) !== modelsFingerprint(outcome.models)) {
      await publish(context, outcome.models)
    }
    return outcome.models
  } catch (error) {
    if (error instanceof DiscoveryError && error.kind === "auth") {
      logger.error(`LiteLLM 认证失败，已撤下全部模型：${error.message}`)
      await publish(context, [])
      return []
    }
    // Network / timeout / 5xx / 429 / parse / redirect / 404-exhausted: keep last good
    // catalog by letting the host record the error.
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(`LiteLLM 发现失败，保留上次结果：${message}`)
    throw error
  }
}

function asStoredCatalog(stored: RefreshModelsContextLike["stored"]): PersistedCatalog | undefined {
  if (!stored || !Array.isArray(stored.models)) return undefined
  const models = stored.models as ProviderModelConfigLike[]
  return { models, checkedAt: 0 }
}

/** Stable fingerprint over the registered model list, for change detection against `stored`. */
function modelsFingerprint(models: readonly ProviderModelConfigLike[] | undefined): string {
  if (!models) return ""
  return JSON.stringify(
    models.map((model) => ({
      id: model.id,
      api: model.api,
      baseUrl: model.baseUrl,
      reasoning: model.reasoning,
      thinkingLevelMap: model.thinkingLevelMap,
      input: model.input,
      cost: model.cost,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
    })),
  )
}

/** Persist the given model list into the host catalog; failures must not fail the refresh. */
async function publish(context: RefreshModelsContextLike, models: ProviderModelConfigLike[]): Promise<void> {
  if (!context.publish) return
  try {
    await context.publish({ persist: { models, checkedAt: Date.now() } })
  } catch (error) {
    // Persistence failure must not prevent this refresh's result from taking effect.
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`LiteLLM 目录持久化失败（不影响本次结果）：${message}`)
  }
}
