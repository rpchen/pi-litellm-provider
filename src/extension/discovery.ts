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
import {
  compareDiscoverySnapshots,
  createDiscoveryCacheDiagnostics,
  createDiscoveryCoordinator,
  createDiscoverySnapshot,
  diagnoseModelSpecs,
  endpointFingerprint,
  inspectDiscoverySnapshot,
  modelFingerprint,
  normalizeLiteLLMURL,
  type DiscoveryCoordinator,
  type DiscoveryDiagnostics,
  type DiscoverySnapshot,
  type ModelSpec,
} from "../core/index.ts"
import { DiscoveryError, fetchLiteLLMModelInfo, getModelsDevCatalog, type FetchLike } from "../net/fetch.ts"
import type { ExtensionConfig } from "./config.ts"
import { setProviderDiagnostics, type ProviderDiagnosticsState } from "./diagnostics.ts"
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
  diagnostics: DiscoveryDiagnostics
}

export type ProviderRefreshCoordinator = DiscoveryCoordinator<DiscoveryOutcome>

/** Create one coordinator per registered provider instance. */
export function createProviderRefreshCoordinator(): ProviderRefreshCoordinator {
  return createDiscoveryCoordinator<DiscoveryOutcome>()
}

/** Persisted payload shape; the host stores it verbatim and replays it in restore phase. */
interface PersistedCatalog {
  models: ProviderModelConfigLike[]
  checkedAt: number
  snapshot?: DiscoverySnapshot
  restoreFingerprint?: string
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
  const diagnosed = diagnoseModelSpecs(litellmResponse, catalog, {
    contextTierCap: config.contextTierCap,
    protocolOverrides: config.protocolOverrides,
  })
  return {
    specs: diagnosed.models,
    models: toProviderModels(diagnosed.models, addresses.rootURL),
    fingerprint: modelFingerprint(diagnosed.models),
    diagnostics: diagnosed.diagnostics,
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
  coordinator: ProviderRefreshCoordinator = createProviderRefreshCoordinator(),
  diagnosticsState?: ProviderDiagnosticsState,
): Promise<ProviderModelConfigLike[]> {
  const logger = deps.logger ?? console
  const stored = asStoredCatalog(context.stored)

  const apiKey = context.credential?.key
  const expectedEndpoint = snapshotEndpointFingerprint(config, apiKey)
  const restoreFingerprint = snapshotRestoreScopeFingerprint(config)
  const storedEndpoint = stored?.snapshot && typeof stored.snapshot.endpointFingerprint === "string"
    ? stored.snapshot.endpointFingerprint
    : undefined
  const restored = expectedEndpoint
    ? inspectDiscoverySnapshot(stored?.snapshot, expectedEndpoint)
    : restoreFingerprint !== undefined &&
        stored?.restoreFingerprint === restoreFingerprint &&
        storedEndpoint !== undefined
      ? inspectDiscoverySnapshot(stored.snapshot, storedEndpoint)
      : { compatible: false as const, reason: "missing" as const }

  const restoreCompatibleModels = (): ProviderModelConfigLike[] => {
    if (!restored.compatible || !restored.snapshot) return []
    try {
      return toProviderModels(restored.snapshot.models, normalizeLiteLLMURL(config.baseUrl).rootURL)
    } catch {
      return []
    }
  }

  // Restore phase, or an aborted request: only replay an endpoint-compatible snapshot.
  if (context.allowNetwork === false || context.signal?.aborted) {
    const models = restoreCompatibleModels()
    setProviderDiagnostics(diagnosticsState, {
      status: models.length > 0 ? "restored" : "idle",
      modelCount: models.length,
      cache: createDiscoveryCacheDiagnostics({
        source: models.length > 0 ? "snapshot" : "none",
        refreshedAt: restored.snapshot ? Date.parse(restored.snapshot.discoveredAt) : undefined,
      }),
      lastSuccessfulDiscoveryAt: restored.snapshot?.discoveredAt,
      note: models.length > 0 ? "当前结果来自 endpoint-compatible 持久化快照。" : undefined,
    })
    return models
  }

  // Not connected: no address resolved. Tell the user how to configure one (spec:
  // 记录说明性提示) and drop the catalog so stale models disappear.
  if (config.baseUrl.length === 0) {
    logger.warn(
      "LiteLLM 未配置地址：请设置 LITELLM_BASE_URL，或在全局 ~/.pi/agent/litellm.json 中填写 baseUrl",
    )
    await publishIfChanged(context, stored, [])
    setProviderDiagnostics(diagnosticsState, {
      status: "unconfigured",
      modelCount: 0,
      cache: createDiscoveryCacheDiagnostics({ source: "none" }),
      note: "请配置 LiteLLM 地址后重新刷新。",
    })
    return []
  }

  if (!apiKey) {
    // The host only reaches the network phase when a credential resolved; treat a missing
    // key defensively as unconfigured rather than sending an unauthenticated request.
    logger.warn("LiteLLM Key 未配置，跳过发现（请使用 /login 或设置 LITELLM_API_KEY）")
    await publishIfChanged(context, stored, [])
    setProviderDiagnostics(diagnosticsState, {
      status: "unconfigured",
      modelCount: 0,
      cache: createDiscoveryCacheDiagnostics({ source: "none" }),
      note: "请使用 /login 或 LITELLM_API_KEY 配置凭据。",
    })
    return []
  }

  const discoveryKey = `${config.endpointId ?? ""}\u0000${config.baseUrl}\u0000${apiKey}`

  try {
    const coordinated = await coordinator.refresh(
      discoveryKey,
      () => discoverModels(config, apiKey, context.signal, deps),
      {
        forceRefresh: context.force === true,
        failurePolicy: (error) => {
          if (context.signal?.aborted) return "ignore"
          if (error instanceof DiscoveryError && error.kind === "auth") return "clear"
          if (normalizeLiteLLMURLFailed(error, config.baseUrl)) return "clear"
          return "stale"
        },
      },
    )
    if (context.signal?.aborted) return restoreCompatibleModels()
    if (coordinated.source === "stale") {
      logger.warn(`LiteLLM 发现失败，使用 last-known-good：${messageOf(coordinated.error)}`)
    }
    const outcome = coordinated.value
    const successfulEndpoint = expectedEndpoint ?? endpointFingerprint({
      endpointID: config.endpointId,
      baseUrl: config.baseUrl,
      credentialKey: apiKey,
      buildOptions: {
        contextTierCap: config.contextTierCap,
        protocolOverrides: config.protocolOverrides,
      },
    })
    const snapshot = createDiscoverySnapshot(
      successfulEndpoint,
      outcome.specs,
      new Date(coordinated.refreshedAt).toISOString(),
    )
    if (restored.compatible && restored.snapshot) {
      const diff = compareDiscoverySnapshots(restored.snapshot, snapshot)
      if (diff.drift) {
        logger.warn(
          `LiteLLM 发现漂移：added=${diff.added.length}, removed=${diff.removed.length}, protocol=${diff.protocolChanged.length}, capabilities=${diff.capabilityChanged.length}`,
        )
      }
    }
    await publishIfChanged(context, stored, outcome.models, snapshot, restoreFingerprint)
    setProviderDiagnostics(diagnosticsState, {
      status: coordinated.source === "stale"
        ? "stale"
        : outcome.models.length === 0 ? "empty" : "ready",
      modelCount: outcome.models.length,
      discovery: outcome.diagnostics,
      cache: createDiscoveryCacheDiagnostics({
        source: coordinated.source === "cache"
          ? "memory-cache"
          : coordinated.source,
        stale: coordinated.stale,
        refreshedAt: coordinated.refreshedAt,
        failureCount: coordinated.failureCount,
        nextRetryAt: coordinated.nextRetryAt,
      }),
      lastSuccessfulDiscoveryAt: new Date(coordinated.refreshedAt).toISOString(),
      note: coordinated.source === "stale" ? "刷新失败，保留上次成功结果。" : undefined,
    })
    return outcome.models
  } catch (error) {
    // Host cancellation (a newer refresh superseded this one, the model selector's 15s
    // catalog budget expired, or the session is shutting down) aborts in-flight requests.
    // That is normal lifecycle, not a failure: replay the persisted baseline silently;
    // the host discards this refresh's result anyway once the signal is aborted.
    if (context.signal?.aborted) {
      return restoreCompatibleModels()
    }
    if (error instanceof DiscoveryError && error.kind === "auth") {
      logger.error(`LiteLLM 认证失败，已撤下全部模型：${error.message}`)
      await publishIfChanged(context, stored, [])
      setProviderDiagnostics(diagnosticsState, {
        status: "auth-error",
        modelCount: 0,
        cache: createDiscoveryCacheDiagnostics({ source: "none" }),
        note: "LiteLLM 返回 401/403；请检查当前凭据权限。",
      })
      return []
    }
    if (normalizeLiteLLMURLFailed(error, config.baseUrl)) {
      // Configuration error (not a transport failure): the address itself is unusable.
      // Spec: 记录错误、不发起发现请求、不注册模型 — so drop the catalog instead of
      // keeping stale models pointed at a dead address.
      logger.error(`LiteLLM 地址无效（${redactUrl(config.baseUrl)}）：${messageOf(error)}`)
      await publishIfChanged(context, stored, [])
      setProviderDiagnostics(diagnosticsState, {
        status: "config-error",
        modelCount: 0,
        cache: createDiscoveryCacheDiagnostics({ source: "none" }),
        note: "LiteLLM 地址无法规范化；未发起发现请求。",
      })
      return []
    }
    // Network / timeout / 5xx / 429 / parse / redirect / 404-exhausted: keep last good
    // catalog by letting the host record the error.
    logger.warn(`LiteLLM 发现失败，保留上次结果：${messageOf(error)}`)
    const state = coordinator.state(discoveryKey)
    setProviderDiagnostics(diagnosticsState, {
      status: "error",
      modelCount: restoreCompatibleModels().length,
      cache: createDiscoveryCacheDiagnostics({
        source: state.hasValue ? "stale" : "none",
        stale: state.hasValue,
        refreshedAt: state.refreshedAt,
        failureCount: state.failureCount,
        nextRetryAt: state.nextRetryAt,
        pending: state.pending,
      }),
      lastSuccessfulDiscoveryAt: state.refreshedAt === undefined
        ? restored.snapshot?.discoveredAt
        : new Date(state.refreshedAt).toISOString(),
      note: "发现失败；详细错误已通过宿主日志记录。",
    })
    throw error
  }
}

/** Whether the error is a host-side cancellation (AbortError / "…aborted" reason). */
function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name === "AbortError" || /aborted/i.test(error.message)
}

const PI_RESTORE_SCOPE_CREDENTIAL = "pi-restore-scope-v1"

function snapshotRestoreScopeFingerprint(config: ExtensionConfig): string | undefined {
  if (config.baseUrl.length === 0) return undefined
  try {
    return endpointFingerprint({
      endpointID: config.endpointId,
      baseUrl: config.baseUrl,
      credentialKey: PI_RESTORE_SCOPE_CREDENTIAL,
      buildOptions: {
        contextTierCap: config.contextTierCap,
        protocolOverrides: config.protocolOverrides,
      },
    })
  } catch {
    return undefined
  }
}

function snapshotEndpointFingerprint(
  config: ExtensionConfig,
  apiKey: string | undefined,
): string | undefined {
  if (config.baseUrl.length === 0 || !apiKey) return undefined
  try {
    return endpointFingerprint({
      endpointID: config.endpointId,
      baseUrl: config.baseUrl,
      credentialKey: apiKey,
      buildOptions: {
        contextTierCap: config.contextTierCap,
        protocolOverrides: config.protocolOverrides,
      },
    })
  } catch {
    return undefined
  }
}

/** Whether the failure came from address normalization (config error, not transport). */
function normalizeLiteLLMURLFailed(error: unknown, _baseUrl: string): boolean {
  if (error instanceof DiscoveryError) return false
  // normalizeLiteLLMURL only rejects non-URL / non-http(s) / credential-bearing strings,
  // always with a message starting with "LiteLLM 地址".
  return messageOf(error).startsWith("LiteLLM 地址")
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Best-effort URL display that never includes userinfo (defensive; config may be raw). */
function redactUrl(value: string): string {
  return value.replace(/\/\/[^/@\s]+@/g, "//***@")
}

/**
 * Persist `models` only when the registered list actually changed. Covers the empty-list
 * branches too, so repeated identical empty results do not rewrite models-store (spec:
 * 仅在内容变化时更新).
 */
async function publishIfChanged(
  context: RefreshModelsContextLike,
  stored: PersistedCatalog | undefined,
  models: ProviderModelConfigLike[],
  snapshot?: DiscoverySnapshot,
  restoreFingerprint?: string,
): Promise<void> {
  const sameModels = modelsFingerprint(stored?.models) === modelsFingerprint(models)
  const sameSnapshot = snapshot === undefined
    ? stored?.snapshot === undefined && stored?.restoreFingerprint === undefined
    : stored?.snapshot?.endpointFingerprint === snapshot.endpointFingerprint &&
      stored.snapshot.modelFingerprint === snapshot.modelFingerprint &&
      stored.restoreFingerprint === restoreFingerprint
  if (sameModels && sameSnapshot) return
  await publish(context, models, snapshot, restoreFingerprint)
}

function asStoredCatalog(stored: RefreshModelsContextLike["stored"]): PersistedCatalog | undefined {
  if (!stored || !Array.isArray(stored.models)) return undefined
  const models = stored.models as ProviderModelConfigLike[]
  const snapshot = "snapshot" in stored ? stored.snapshot as DiscoverySnapshot | undefined : undefined
  const restoreFingerprint = "restoreFingerprint" in stored && typeof stored.restoreFingerprint === "string"
    ? stored.restoreFingerprint
    : undefined
  return { models, checkedAt: 0, snapshot, restoreFingerprint }
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
async function publish(
  context: RefreshModelsContextLike,
  models: ProviderModelConfigLike[],
  snapshot?: DiscoverySnapshot,
  restoreFingerprint?: string,
): Promise<void> {
  if (!context.publish) return
  // A cancelled refresh must not write the store: skip before racing the abort.
  if (context.signal?.aborted) return
  try {
    await context.publish({ persist: { models, checkedAt: Date.now(), snapshot, restoreFingerprint } })
  } catch (error) {
    // The host's publish rejects with an abort reason when cancellation lands during the
    // write (supersede / 15s catalog timeout / shutdown) — normal lifecycle, not a
    // persistence failure. Only real store errors (disk, permissions) are worth a warning.
    if (context.signal?.aborted || isAbortError(error)) return
    // Persistence failure must not prevent this refresh's result from taking effect.
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`LiteLLM 目录持久化失败（不影响本次结果）：${message}`)
  }
}
