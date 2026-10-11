/**
 * Pi extension factory and PR9 global endpoint orchestration.
 *
 * Discovery remains single-endpoint internally. This adapter creates one independent
 * provider/diagnostics/coordinator/poll lifecycle for every active endpoint.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { normalizeLiteLLMURL } from "../core/index.ts"
import {
  activeEndpointIds,
  activationPath,
  loadActivation,
  saveActivation,
  toggleEndpoint,
  type EndpointActivation,
} from "./activation.ts"
import { getAgentDir } from "@earendil-works/pi-coding-agent"
import { join } from "node:path"
import { createEndpointManager, type ManagementContext } from "./endpoint-management.ts"
import { createAuditReport } from "./audit.ts"
import { auditDirectory, auditFailureMessage, writeAuditFile } from "./audit-file.ts"
import {
  DEFAULT_ENDPOINT_ID,
  loadEndpointRegistry,
  type EndpointRegistryConfig,
  type ExtensionConfig,
} from "./config.ts"
import {
  catalogNotice,
  createProviderDiagnosticsState,
  formatProviderDiagnostics,
  publicationControllerForState,
  setProviderDiagnostics,
  takePendingNotice,
  type ProviderDiagnosticsState,
} from "./diagnostics.ts"
import {
  applyErrorLabel,
  credentialLabel,
  initialEndpointState,
  statusLabel,
  userVisibleStatus,
  type AppliedState,
  type CredentialState,
  type EndpointState,
  type ValidationState,
} from "./endpoint-state.ts"
import { formatStartupIdentityLine, getRuntimeIdentity } from "./runtime-identity.ts"
import { createProviderRefreshCoordinator, refreshProviderModels, type DiscoveryDeps } from "./discovery.ts"
import { credentialState as resolveCredentialState } from "./host-state.ts"
import {
  PROVIDER_ID,
  providerIdForEndpoint,
  providerNameForEndpoint,
} from "./provider-id.ts"
import type { ProviderConfigLike, RefreshModelsContextLike } from "./types.ts"

export { PROVIDER_ID, providerIdForEndpoint, providerNameForEndpoint }

export function normalizedProviderBaseUrl(raw: string): string {
  if (raw.length === 0) return ""
  try {
    return normalizeLiteLLMURL(raw).rootURL
  } catch {
    return ""
  }
}

export function buildProviderConfig(
  getConfig: () => ExtensionConfig,
  deps?: DiscoveryDeps,
  diagnosticsState: ProviderDiagnosticsState = createProviderDiagnosticsState(),
  endpointId: string = DEFAULT_ENDPOINT_ID,
): ProviderConfigLike {
  const coordinator = createProviderRefreshCoordinator()
  const refresh = (context: RefreshModelsContextLike) => {
    if (endpointId !== DEFAULT_ENDPOINT_ID && !context.credential?.key) {
      setProviderDiagnostics(diagnosticsState, {
        status: "credential-missing",
        modelCount: 0,
        models: [],
        note: `endpoint ${endpointId} 尚未保存凭据；请通过 /login 选择 ${providerNameForEndpoint(endpointId)}。`,
      })
      return Promise.resolve([])
    }
    return refreshProviderModels(getConfig(), context, deps, coordinator, diagnosticsState)
  }
  return {
    name: providerNameForEndpoint(endpointId),
    baseUrl: normalizedProviderBaseUrl(getConfig().baseUrl),
    // Environment credentials are intentionally legacy/default-only.
    apiKey: endpointId === DEFAULT_ENDPOINT_ID ? "$LITELLM_API_KEY" : "",
    models: [],
    refreshModels: refresh,
  }
}

export function startPolling(pollIntervalSeconds: number, refresh: () => Promise<void>): () => void {
  let active = true
  const timer = setInterval(() => {
    if (!active) return
    void refresh().catch(() => {})
  }, pollIntervalSeconds * 1000)
  timer.unref?.()
  return () => {
    if (!active) return
    active = false
    clearInterval(timer)
  }
}

export interface FactoryInternals {
  /** Legacy single-endpoint test injection. */
  config?: ExtensionConfig
  /** PR9 registry injection. */
  registry?: EndpointRegistryConfig
  activation?: EndpointActivation
  activationFile?: string
  /** Agent state directory (litellm.json / auth.json / models-store.json); defaults to Pi's agent dir. */
  agentDir?: string
  /** Environment used for legacy LITELLM_* resolution; defaults to process.env. */
  env?: Record<string, string | undefined>
  deps?: DiscoveryDeps
  cwd?: string
  /** Startup identity log sink; defaults to console. */
  logger?: { info?: (line: string) => void; log?: (line: string) => void }
  /** Test seams for the config writer. */
  write?: { rename?: (from: string, to: string) => void; beforeCommit?: () => void }
}

function register(pi: ExtensionAPI, endpointId: string, config: ProviderConfigLike): void {
  pi.registerProvider(
    providerIdForEndpoint(endpointId),
    config as Parameters<ExtensionAPI["registerProvider"]>[1],
  )
}

function registryFromLegacy(config: ExtensionConfig): EndpointRegistryConfig {
  return {
    mode: "legacy",
    endpoints: { [DEFAULT_ENDPOINT_ID]: config },
    globalConfigPath: config.globalConfigPath,
  }
}

export default function piLitellmProvider(pi: ExtensionAPI, internals: FactoryInternals = {}): void {
  const agentDir = internals.agentDir ?? getAgentDir()
  const env = internals.env ?? process.env
  const resolveRegistry = (cwd: string): EndpointRegistryConfig =>
    internals.registry ??
    (internals.config
      ? registryFromLegacy(internals.config)
      : loadEndpointRegistry(cwd, internals.deps?.logger ?? console, env, agentDir))

  let registry = resolveRegistry(internals.cwd ?? process.cwd())
  const activationFile = internals.activationFile ?? activationPath(agentDir)
  let activation = internals.activation ?? loadActivation(activationFile)
  const diagnostics = new Map<string, ProviderDiagnosticsState>()
  const registered = new Set<string>()
  const registeredBaseUrls = new Map<string, string>()
  const pollStops = new Map<string, () => void>()
  // Canonical endpoint state — the source of truth every user-visible surface derives from.
  const endpointStates = new Map<string, EndpointState>()

  const stateFor = (endpointId: string): ProviderDiagnosticsState => {
    let state = diagnostics.get(endpointId)
    if (!state) {
      state = createProviderDiagnosticsState()
      diagnostics.set(endpointId, state)
    }
    return state
  }

  const resolveCredential = (endpointId: string): CredentialState => {
    const stored = resolveCredentialState(agentDir, providerIdForEndpoint(endpointId))
    if (stored === "stored") return "stored"
    if (stored === "unknown") return "unknown"
    // Environment credential is legacy/default-only (matches buildProviderConfig).
    if (endpointId === DEFAULT_ENDPOINT_ID && env.LITELLM_API_KEY?.trim()) return "environment"
    return "none"
  }

  const computeDesired = (endpointId: string): "enabled" | "disabled" =>
    activeEndpointIds(Object.keys(registry.endpoints), activation).includes(endpointId) ? "enabled" : "disabled"

  const computeValidation = (endpointId: string): ValidationState =>
    registry.endpoints[endpointId]?.validation ?? { kind: "ok" }

  const setApplied = (endpointId: string, applied: AppliedState): void => {
    const existing = endpointStates.get(endpointId)
    const desired = computeDesired(endpointId)
    const validation = computeValidation(endpointId)
    const credential = resolveCredential(endpointId)
    endpointStates.set(endpointId, { endpointId, desired, validation, credential, applied })
  }

  const endpointStateFor = (endpointId: string): EndpointState => {
    const existing = endpointStates.get(endpointId)
    const desired = computeDesired(endpointId)
    const validation = computeValidation(endpointId)
    const credential = resolveCredential(endpointId)
    // Apply-failure must never silently revert desired state. We always recompute
    // desired/validation/credential from the persisted truth and only treat `applied`
    // as process-local runtime memory.
    const applied: AppliedState = existing?.applied ?? { kind: "not-applied" }
    const merged: EndpointState = { endpointId, desired, validation, credential, applied }
    endpointStates.set(endpointId, merged)
    return merged
  }

  const activeIds = () => activeEndpointIds(Object.keys(registry.endpoints), activation)

  const syncProviders = () => {
    const next = new Set(activeIds())
    for (const endpointId of [...registered]) {
      if (next.has(endpointId)) continue
      pi.unregisterProvider(providerIdForEndpoint(endpointId))
      registered.delete(endpointId)
      registeredBaseUrls.delete(endpointId)
      pollStops.get(endpointId)?.()
      pollStops.delete(endpointId)
      setProviderDiagnostics(stateFor(endpointId), { status: "inactive", modelCount: 0, models: [] })
      setApplied(endpointId, { kind: "not-applied" })
    }
    for (const endpointId of next) {
      const endpoint = registry.endpoints[endpointId]
      if (!endpoint) continue
      // Invalid endpoints are never registered with the host runtime. They remain
      // visible in management/diagnostics as "Invalid configuration" with no provider.
      if ((endpoint.validation?.kind ?? "ok") === "invalid") {
        setApplied(endpointId, { kind: "error", category: "config-invalid", message: endpoint.validation?.kind === "invalid" ? endpoint.validation.reason : undefined })
        setProviderDiagnostics(stateFor(endpointId), {
          status: "config-error",
          modelCount: 0,
          models: [],
          note: endpoint.validation?.kind === "invalid" ? endpoint.validation.reason : undefined,
        })
        continue
      }
      // Credential-missing endpoints register the provider so /login can target
      // it, but runtime apply is "error(credential-missing)" until a key resolves
      // — refreshModels will return [] and the canonical state stays truthful.
      const currentCredential = resolveCredential(endpointId)
      const hasCredential = currentCredential === "stored" || currentCredential === "environment"
      const baseUrl = normalizedProviderBaseUrl(endpoint.baseUrl)
      if (!registered.has(endpointId) || registeredBaseUrls.get(endpointId) !== baseUrl) {
        // Pi starts an asynchronous restore-only model refresh on registration.
        // Re-registering an unchanged provider during an explicit refresh can
        // supersede its network refresh while it is loading the same config.
        register(pi, endpointId, buildProviderConfig(
          () => registry.endpoints[endpointId]!,
          {
            ...internals.deps,
            appliedWriter: (next) => setApplied(endpointId, next),
          },
          stateFor(endpointId),
          endpointId,
        ))
        registered.add(endpointId)
        registeredBaseUrls.set(endpointId, baseUrl)
      }
      // After registerProvider returns, the endpoint is applied to the host runtime
      // (registry is visible). Discovery outcome is reported separately via refresh.
      const existingApplied = endpointStates.get(endpointId)?.applied
      if (existingApplied?.kind === "active" || existingApplied?.kind === "error") {
        // Preserve the more specific runtime state on re-sync (e.g. after an edit).
        // Reset when the registration was re-created through deactivate → activate.
      } else if (!hasCredential) {
        setApplied(endpointId, { kind: "error", category: "credential-missing" })
      } else {
        setApplied(endpointId, { kind: "active", modelCount: 0 })
      }
    }
  }

  const stopAllPolling = () => {
    for (const stop of pollStops.values()) stop()
    pollStops.clear()
  }

  /** Surface a materially new or regressed availability problem, exactly once. */
  const notifyCatalog = (ctx: ManagementContext, endpointId: string) => {
    const pending = takePendingNotice(stateFor(endpointId))
    if (!pending) return
    const summary = stateFor(endpointId).current.publication
    if (!summary) return
    // The notice text is composed from the current summary (regressed model
    // names, counts) plus the decision reason — never from stored prose.
    const notice = catalogNotice({
      ...summary,
      acknowledgement: { ...summary.acknowledgement, notify: true, reason: pending.reason },
    })
    if (!notice) return
    ctx.ui.notify(`LiteLLM ${endpointId}：${notice.message}`, notice.level)
  }

  const startActivePolling = (ctx: ManagementContext) => {
    stopAllPolling()
    for (const endpointId of activeIds()) {
      const endpoint = registry.endpoints[endpointId]
      if (!endpoint) continue
      const providerId = providerIdForEndpoint(endpointId)
      // Poll cadence is pollInterval-based; the host's own catalog load at session
      // start already triggers the immediate refresh for us (via get_available_models).
      pollStops.set(endpointId, startPolling(endpoint.pollInterval, () =>
        ctx.modelRegistry.refresh({ providers: [providerId], force: true }).then(() => {
          notifyCatalog(ctx, endpointId)
        }),
      ))
    }
  }

  const persistActivation = (next: EndpointActivation) => {
    activation = next
    if (!internals.activation) saveActivation(next, activationFile)
  }

  pi.registerCommand("litellm-diagnostics", {
    description: "显示 LiteLLM endpoint 总览，或传 endpoint id 查看详情",
    handler: async (args, ctx) => {
      const endpointId = args.trim()
      if (endpointId) {
        if (!(endpointId in registry.endpoints)) {
          ctx.ui.notify(`未知 LiteLLM endpoint：${endpointId}`, "warning")
          return
        }
        // Diagnostics never degrades to a placeholder: every endpoint gets a full canonical
        // record regardless of desired/validation/credential/applied state.
        const state = endpointStateFor(endpointId)
        const status = statusLabel(userVisibleStatus(state))
        const desired = state.desired === "enabled" ? "已启用" : "未启用"
        const validation = state.validation.kind === "ok"
          ? "合法"
          : `非法（${state.validation.reason}）`
        const applied = state.applied.kind === "active"
          ? `已生效（${state.applied.modelCount} 个模型${state.applied.lastDiscoveryAt ? `，最近成功发现 ${state.applied.lastDiscoveryAt}` : ""}）`
          : state.applied.kind === "not-applied"
            ? "未生效"
            : `出错（${applyErrorLabel(state.applied.category)}${state.applied.message ? `：${state.applied.message}` : ""}）`
        const currentSnapshot = stateFor(endpointId).current
        const lines = [
          `Endpoint：${endpointId}`,
          `Provider：${providerIdForEndpoint(endpointId)}`,
          `状态：${status}`,
          `期望状态：${desired}`,
          `配置：${validation}`,
          `凭据：${credentialLabel(state.credential)}`,
          `Runtime：${applied}`,
          `当前注册模型数：${currentSnapshot.modelCount}`,
          "",
          formatProviderDiagnostics(stateFor(endpointId)),
        ]
        ctx.ui.notify(lines.join("\n"), "info")
        return
      }
      const lines = [
        "LiteLLM Endpoints",
        ...Object.keys(registry.endpoints).map((id) => {
          const state = endpointStateFor(id)
          const snapshot = stateFor(id).current
          const marker = state.desired === "enabled" ? "✓" : "○"
          return `${marker} ${id} · ${providerIdForEndpoint(id)} · ${statusLabel(userVisibleStatus(state))} · models=${snapshot.modelCount}`
        }),
      ]
      ctx.ui.notify(lines.join("\n"), "info")
    },
  })

  pi.registerCommand("litellm-audit-export", {
    description: "导出 LiteLLM 已注册模型清单与 Runtime Identity，或传 endpoint id 只导出该 endpoint",
    handler: async (args, ctx) => {
      const endpointId = args.trim()
      if (endpointId && !(endpointId in registry.endpoints)) {
        ctx.ui.notify(`未知 LiteLLM endpoint：${endpointId}`, "warning")
        return
      }
      const active = new Set(activeIds())
      const ids = endpointId ? [endpointId] : Object.keys(registry.endpoints).filter((id) => active.has(id))
      if (!endpointId && ids.length === 0) {
        ctx.ui.notify("当前没有已激活的 LiteLLM endpoint", "warning")
        return
      }
      if (endpointId && !active.has(endpointId)) {
        setProviderDiagnostics(stateFor(endpointId), { status: "inactive", modelCount: 0, models: [] })
      }
      const report = createAuditReport(
        ids.map((id) => ({
          id,
          providerId: providerIdForEndpoint(id),
          status: stateFor(id).current.status,
          models: stateFor(id).current.models ?? [],
          discovery: stateFor(id).current.discovery,
          cacheSource: stateFor(id).current.cache?.source,
          lkgIDs: stateFor(id).current.publication?.lkgIDs,
        })),
      )
      try {
        const file = writeAuditFile(report, auditDirectory(agentDir))
        ctx.ui.notify(`LiteLLM 审查报告已导出：${file}`, "info")
      } catch (error) {
        ctx.ui.notify(`LiteLLM 审查报告导出失败：${auditFailureMessage(error)}`, "error")
      }
    },
  })

  const manager = createEndpointManager({
    agentDir,
    configPath: join(agentDir, "litellm.json"),
    env,
    reload: () => {
      if (internals.registry || internals.config) return
      registry = resolveRegistry(internals.cwd ?? process.cwd())
      if (!internals.activation) activation = loadActivation(activationFile, internals.deps?.logger ?? console)
    },
    registry: () => registry,
    activation: () => activation,
    persistActivation,
    sync: (ctx) => {
      syncProviders()
      startActivePolling(ctx)
      // The manager has just force-refreshed the active endpoints: surface any
      // material availability change (regression / unusable catalog) once.
      for (const id of activeIds()) notifyCatalog(ctx, id)
    },
    forget: (endpointId) => {
      diagnostics.delete(endpointId)
      endpointStates.delete(endpointId)
    },
    endpointState: endpointStateFor,
    write: internals.write,
  })

  pi.registerCommand("litellm-endpoints", {
    description: "管理全局 LiteLLM endpoint：新增、修改、删除、启用/停用、凭据",
    handler: async (args, ctx) => {
      await manager.run(args, ctx)
    },
  })

  syncProviders()

  try {
    const startupLogger = internals.logger ?? console
    const line = formatStartupIdentityLine(getRuntimeIdentity())
    if (typeof startupLogger.info === "function") startupLogger.info(line)
    else if (typeof startupLogger.log === "function") startupLogger.log(line)
  } catch {
    // Startup identity logging must never block extension setup.
  }

  pi.on("session_start", async (_event, ctx) => {
    registry = resolveRegistry(ctx.cwd)
    if (!internals.activation) activation = loadActivation(activationFile)
    syncProviders()
    startActivePolling(ctx)
  })

  pi.on("session_shutdown", async () => {
    stopAllPolling()
  })
}
