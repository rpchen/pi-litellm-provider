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
import { createEndpointManager } from "./endpoint-management.ts"
import { createAuditReport } from "./audit.ts"
import { auditDirectory, auditFailureMessage, writeAuditFile } from "./audit-file.ts"
import {
  DEFAULT_ENDPOINT_ID,
  loadEndpointRegistry,
  type EndpointRegistryConfig,
  type ExtensionConfig,
} from "./config.ts"
import {
  createProviderDiagnosticsState,
  formatProviderDiagnostics,
  publicationControllerForState,
  setProviderDiagnostics,
  type ProviderDiagnosticsState,
} from "./diagnostics.ts"
import { formatStartupIdentityLine, getRuntimeIdentity } from "./runtime-identity.ts"
import { createProviderRefreshCoordinator, refreshProviderModels, type DiscoveryDeps } from "./discovery.ts"
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
  const pollStops = new Map<string, () => void>()

  const stateFor = (endpointId: string): ProviderDiagnosticsState => {
    let state = diagnostics.get(endpointId)
    if (!state) {
      state = createProviderDiagnosticsState()
      diagnostics.set(endpointId, state)
    }
    return state
  }

  const activeIds = () => activeEndpointIds(Object.keys(registry.endpoints), activation)

  const syncProviders = () => {
    const next = new Set(activeIds())
    for (const endpointId of [...registered]) {
      if (next.has(endpointId)) continue
      pi.unregisterProvider(providerIdForEndpoint(endpointId))
      registered.delete(endpointId)
      pollStops.get(endpointId)?.()
      pollStops.delete(endpointId)
      setProviderDiagnostics(stateFor(endpointId), { status: "inactive", modelCount: 0, models: [] })
    }
    for (const endpointId of next) {
      const endpoint = registry.endpoints[endpointId]
      if (!endpoint) continue
      register(pi, endpointId, buildProviderConfig(() => registry.endpoints[endpointId]!, internals.deps, stateFor(endpointId), endpointId))
      registered.add(endpointId)
    }
  }

  const stopAllPolling = () => {
    for (const stop of pollStops.values()) stop()
    pollStops.clear()
  }

  const startActivePolling = (ctx: { modelRegistry: { refresh(input: { providers: string[]; force: boolean }): Promise<unknown> } }) => {
    stopAllPolling()
    for (const endpointId of activeIds()) {
      const endpoint = registry.endpoints[endpointId]
      if (!endpoint) continue
      const providerId = providerIdForEndpoint(endpointId)
      pollStops.set(endpointId, startPolling(endpoint.pollInterval, () =>
        ctx.modelRegistry.refresh({ providers: [providerId], force: true }).then(() => undefined),
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
        const active = activeIds().includes(endpointId)
        if (!active) setProviderDiagnostics(stateFor(endpointId), { status: "inactive", modelCount: 0, models: [] })
        ctx.ui.notify(
          `Endpoint：${endpointId}\nProvider：${providerIdForEndpoint(endpointId)}\n${formatProviderDiagnostics(stateFor(endpointId))}`,
          "info",
        )
        return
      }
      const active = new Set(activeIds())
      const lines = [
        "LiteLLM Endpoints",
        ...Object.keys(registry.endpoints).map((id) => {
          const snapshot = stateFor(id).current
          return `${active.has(id) ? "✓" : "○"} ${id} · ${providerIdForEndpoint(id)} · ${snapshot.status} · models=${snapshot.modelCount}`
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
    },
    forget: (endpointId) => {
      diagnostics.delete(endpointId)
    },
    write: internals.write,
  })

  pi.registerCommand("litellm-accept-degraded", {
    description: "接受指定 endpoint 上未完成模型的降级配置（仍标记为 degraded，非完整配置）",
    handler: async (args, ctx) => {
      const [endpointId, modelId] = args.trim().split(/\s+/)
      if (!endpointId || !modelId || !(endpointId in registry.endpoints)) {
        ctx.ui.notify(
          `用法：litellm-accept-degraded <endpoint-id> <model-id>；未知 endpoint：${endpointId ?? ""}`,
          "warning",
        )
        return
      }
      const state = stateFor(endpointId)
      const blocked = state.current.publication?.blocked.find((model) => model.id === modelId)
      if (!blocked) {
        const registered = (state.current.models ?? []).some((model) => model.id === modelId)
        ctx.ui.notify(
          registered ? `${modelId} 已是完整配置，无需降级接受。` : `未知或不可降级模型：${modelId}`,
          registered ? "info" : "warning",
        )
        return
      }
      publicationControllerForState(state).acceptedDegradedIDs.add(modelId)
      try {
        await ctx.modelRegistry?.refresh?.({
          providers: [providerIdForEndpoint(endpointId)],
          force: true,
        })
      } catch {
        // Refresh errors surface through diagnostics; acceptance is kept.
      }
      ctx.ui.notify(
        `已接受降级：${modelId}（${blocked.status}；缺口：${blocked.gaps.join("、") || "无"}），仍标记为降级配置。`,
        "info",
      )
    },
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
