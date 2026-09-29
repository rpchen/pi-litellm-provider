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
import {
  DEFAULT_ENDPOINT_ID,
  loadEndpointRegistry,
  type EndpointRegistryConfig,
  type ExtensionConfig,
} from "./config.ts"
import {
  createProviderDiagnosticsState,
  formatProviderDiagnostics,
  setProviderDiagnostics,
  type ProviderDiagnosticsState,
} from "./diagnostics.ts"
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
  deps?: DiscoveryDeps
  cwd?: string
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
  const resolveRegistry = (cwd: string): EndpointRegistryConfig =>
    internals.registry ??
    (internals.config ? registryFromLegacy(internals.config) : loadEndpointRegistry(cwd))

  let registry = resolveRegistry(internals.cwd ?? process.cwd())
  const activationFile = internals.activationFile ?? activationPath()
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
      setProviderDiagnostics(stateFor(endpointId), { status: "inactive", modelCount: 0 })
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
        if (!active) setProviderDiagnostics(stateFor(endpointId), { status: "inactive", modelCount: 0 })
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

  pi.registerCommand("litellm-endpoints", {
    description: "管理全局 LiteLLM endpoint activation",
    handler: async (args, ctx) => {
      const ids = Object.keys(registry.endpoints)
      if (ids.length === 0) {
        ctx.ui.notify("当前没有已配置的 LiteLLM endpoint", "warning")
        return
      }

      let action = args.trim()
      if (!action) {
        const active = new Set(activeIds())
        const options = [
          "全部启用",
          "全部停用",
          ...ids.map((id) => `${active.has(id) ? "✓" : "○"} ${id}`),
        ]
        action = await ctx.ui.select("LiteLLM endpoints", options) ?? ""
      }
      if (!action) return

      if (action === "all" || action === "全部启用") {
        persistActivation({ mode: "all" })
      } else if (action === "none" || action === "全部停用") {
        persistActivation({ mode: "selected", endpointIds: [] })
      } else {
        const endpointId = action.replace(/^[✓○]\s+/, "")
        if (!ids.includes(endpointId)) {
          ctx.ui.notify(`未知 LiteLLM endpoint：${endpointId}`, "warning")
          return
        }
        persistActivation(toggleEndpoint(ids, activation, endpointId))
      }

      syncProviders()
      startActivePolling(ctx)
      const providers = activeIds().map(providerIdForEndpoint)
      if (providers.length > 0) {
        await ctx.modelRegistry.refresh({ providers, force: true })
      }
      ctx.ui.notify(`已激活 endpoint：${activeIds().join(", ") || "无"}`, "info")
    },
  })

  syncProviders()

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
