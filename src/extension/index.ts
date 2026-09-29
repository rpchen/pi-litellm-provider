/**
 * Pi extension factory.
 *
 * Legacy mode preserves the single `litellm` provider. Explicit multi-endpoint mode
 * registers only activated endpoints, each under its own stable provider identity.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { normalizeLiteLLMURL } from "../core/index.ts"
import {
  activationForSelection,
  activeEndpointIDs,
  createActivationStore,
  type ActivationState,
  type ActivationStore,
} from "./activation.ts"
import {
  configuredEndpoints,
  endpointRuntimeConfig,
  isExplicitMultiEndpointConfig,
  loadConfig,
  type EndpointConfig,
  type ExtensionConfig,
} from "./config.ts"
import {
  createProviderDiagnosticsState,
  formatEndpointDiagnostics,
  formatMultiEndpointDiagnostics,
  formatProviderDiagnostics,
  type ProviderDiagnosticsState,
} from "./diagnostics.ts"
import { createProviderRefreshCoordinator, refreshProviderModels, type DiscoveryDeps } from "./discovery.ts"
import {
  PROVIDER_ID,
  providerDisplayName,
  providerIDForEndpoint,
} from "./provider-id.ts"
import type { ProviderConfigLike, RefreshModelsContextLike } from "./types.ts"

export { PROVIDER_ID, providerIDForEndpoint }

export function normalizedProviderBaseUrl(raw: string): string {
  if (raw.length === 0) return ""
  try {
    return normalizeLiteLLMURL(raw).rootURL
  } catch {
    return ""
  }
}

/** Build one isolated provider runtime. One call owns one refresh coordinator. */
export function buildProviderConfig(
  getConfig: () => ExtensionConfig,
  deps?: DiscoveryDeps,
  diagnosticsState: ProviderDiagnosticsState = createProviderDiagnosticsState(),
): ProviderConfigLike {
  const coordinator = createProviderRefreshCoordinator()
  const initial = getConfig()
  return {
    name: providerDisplayName(initial.endpointID ?? "default", initial.endpointID !== undefined),
    baseUrl: normalizedProviderBaseUrl(initial.baseUrl),
    // Stored /login credentials remain provider-ID scoped by Pi. The historical env
    // fallback remains available; using one env key for several endpoints is an explicit
    // user choice and does not merge provider identity or snapshots.
    apiKey: "$LITELLM_API_KEY",
    models: [],
    refreshModels: (context: RefreshModelsContextLike) =>
      refreshProviderModels(getConfig(), context, deps, coordinator, diagnosticsState),
  }
}

export function startPolling(pollIntervalSeconds: number, refresh: () => Promise<void>): () => void {
  let active = true
  const timer = setInterval(() => {
    if (!active) return
    void refresh().catch(() => {
      // Endpoint refresh errors are recorded independently; the global scheduler stays alive.
    })
  }, pollIntervalSeconds * 1000)
  timer.unref?.()
  return () => {
    if (!active) return
    active = false
    clearInterval(timer)
  }
}

export interface FactoryInternals {
  config?: ExtensionConfig
  deps?: DiscoveryDeps
  cwd?: string
  /** Test/embedding injection. Production persists next to global litellm.json. */
  activationStore?: ActivationStore
}

function register(pi: ExtensionAPI, id: string, config: ProviderConfigLike): void {
  pi.registerProvider(id, config as Parameters<ExtensionAPI["registerProvider"]>[1])
}

interface Runtime {
  signature: string
  endpoint: EndpointConfig
  provider: ProviderConfigLike
  diagnostics: ProviderDiagnosticsState
}

function endpointSignature(config: ExtensionConfig, endpoint: EndpointConfig): string {
  return JSON.stringify({
    baseUrl: endpoint.baseUrl,
    protocolOverrides: endpoint.protocolOverrides,
    contextTierCap: config.contextTierCap,
    explicit: isExplicitMultiEndpointConfig(config),
  })
}

export default function piLitellmProvider(pi: ExtensionAPI, internals: FactoryInternals = {}): void {
  const resolveConfig = (cwd: string): ExtensionConfig => internals.config ?? loadConfig(cwd)

  let config = resolveConfig(internals.cwd ?? process.cwd())
  let activationStore = internals.activationStore ?? createActivationStore(config.globalConfigPath)
  let activationState: ActivationState = activationStore.read()

  const runtimes = new Map<string, Runtime>()
  const diagnosticsStates = new Map<string, ProviderDiagnosticsState>()
  const registered = new Set<string>()

  const stateFor = (endpointID: string): ProviderDiagnosticsState => {
    const existing = diagnosticsStates.get(endpointID)
    if (existing) return existing
    const created = createProviderDiagnosticsState()
    diagnosticsStates.set(endpointID, created)
    return created
  }

  const endpointByID = (endpointID: string): EndpointConfig | undefined =>
    configuredEndpoints(config).find((endpoint) => endpoint.id === endpointID)

  const currentRuntimeConfig = (endpointID: string, fallback: EndpointConfig): ExtensionConfig => {
    const endpoint = endpointByID(endpointID) ?? fallback
    return endpointRuntimeConfig(config, endpoint)
  }

  const reconcileProviders = (): { activeIDs: string[]; newlyActive: string[] } => {
    const endpoints = configuredEndpoints(config)
    const byID = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint]))
    const activeIDs = activeEndpointIDs(config, activationState)
    const activeSet = new Set(activeIDs)
    const newlyActive: string[] = []

    for (const endpointID of [...registered]) {
      if (activeSet.has(endpointID) && byID.has(endpointID)) continue
      pi.unregisterProvider(providerIDForEndpoint(endpointID))
      registered.delete(endpointID)
    }

    for (const endpointID of activeIDs) {
      const endpoint = byID.get(endpointID)
      if (!endpoint) continue
      const signature = endpointSignature(config, endpoint)
      let runtime = runtimes.get(endpointID)
      if (!runtime || runtime.signature !== signature) {
        const diagnostics = stateFor(endpointID)
        const captured = endpoint
        runtime = {
          signature,
          endpoint,
          diagnostics,
          provider: buildProviderConfig(
            () => currentRuntimeConfig(endpointID, captured),
            internals.deps,
            diagnostics,
          ),
        }
        runtimes.set(endpointID, runtime)
      }

      if (!registered.has(endpointID)) newlyActive.push(endpointID)
      register(pi, providerIDForEndpoint(endpointID), runtime.provider)
      registered.add(endpointID)
    }

    return { activeIDs, newlyActive }
  }

  const activeSet = (): Set<string> => new Set(activeEndpointIDs(config, activationState))

  pi.registerCommand("litellm-diagnostics", {
    description: "显示 LiteLLM endpoint、发现、协议、缓存与构建诊断",
    handler: async (args, ctx) => {
      const requested = args.trim()
      if (!isExplicitMultiEndpointConfig(config)) {
        const state = stateFor("default")
        const status = state.current.status
        const level = status === "auth-error" || status === "config-error" || status === "error"
          ? "warning"
          : "info"
        ctx.ui.notify(formatProviderDiagnostics(state), level)
        return
      }

      const endpoints = configuredEndpoints(config)
      const active = activeSet()
      if (requested.length > 0) {
        const endpoint = endpoints.find((candidate) => candidate.id === requested)
        if (!endpoint) {
          ctx.ui.notify(`未知 LiteLLM endpoint：${requested}`, "warning")
          return
        }
        const state = stateFor(endpoint.id)
        const status = state.current.status
        const level = status === "auth-error" || status === "config-error" || status === "error"
          ? "warning"
          : "info"
        ctx.ui.notify(formatEndpointDiagnostics(endpoint.id, active.has(endpoint.id), state), level)
        return
      }

      let message = formatMultiEndpointDiagnostics(
        endpoints.map((endpoint) => ({
          id: endpoint.id,
          active: active.has(endpoint.id),
          state: stateFor(endpoint.id),
        })),
      )
      if ((config.configIssues?.length ?? 0) > 0) {
        message += `\n配置问题：${config.configIssues!.join("；")}`
      }
      ctx.ui.notify(message, (config.configIssues?.length ?? 0) > 0 ? "warning" : "info")
    },
  })

  pi.registerCommand("litellm-endpoints", {
    description: "管理全局 LiteLLM endpoints 的激活状态",
    handler: async (_args, ctx) => {
      if (!isExplicitMultiEndpointConfig(config)) {
        ctx.ui.notify("当前使用 legacy 单 endpoint 配置；/litellm-endpoints 仅管理显式 endpoints 模式。", "info")
        return
      }
      const endpoints = configuredEndpoints(config)
      if (endpoints.length === 0) {
        ctx.ui.notify("没有可激活的 LiteLLM endpoint；请先修正全局 litellm.json。", "warning")
        return
      }

      const ids = endpoints.map((endpoint) => endpoint.id)
      const before = new Set(activeEndpointIDs(config, activationState))
      const selected = new Set(before)
      let preferAll = activationState.mode === "all"

      while (true) {
        const options = [
          ...ids.map((id) => `${selected.has(id) ? "[x]" : "[ ]"} ${id}`),
          "Activate all",
          "Apply",
          "Cancel",
        ]
        const choice = await ctx.ui.select("LiteLLM endpoints", options)
        if (choice === undefined || choice === "Cancel") return
        if (choice === "Activate all") {
          for (const id of ids) selected.add(id)
          preferAll = true
          continue
        }
        if (choice === "Apply") {
          activationState = activationForSelection(ids, selected, preferAll)
          activationStore.write(activationState)
          const reconciled = reconcileProviders()
          const added = reconciled.activeIDs.filter((id) => !before.has(id))
          await Promise.allSettled(
            added.map((id) =>
              ctx.modelRegistry.refresh({ providers: [providerIDForEndpoint(id)], force: true }),
            ),
          )
          ctx.ui.notify(
            `LiteLLM endpoints 已应用：active=${reconciled.activeIDs.length}/${ids.length}`,
            "info",
          )
          return
        }
        const id = choice.slice(4)
        if (!ids.includes(id)) continue
        if (selected.has(id)) selected.delete(id)
        else selected.add(id)
        preferAll = false
      }
    },
  })

  reconcileProviders()

  let stopPolling: (() => void) | undefined

  pi.on("session_start", async (_event, ctx) => {
    config = resolveConfig(ctx.cwd)
    if (!internals.activationStore) activationStore = createActivationStore(config.globalConfigPath)
    activationState = activationStore.read()
    reconcileProviders()

    // Recreate one scheduler at the current global interval; endpoint refreshes within a
    // tick are independent and concurrent. With 0 active endpoints it performs no I/O.
    stopPolling?.()
    stopPolling = startPolling(config.pollInterval, async () => {
      const providers = activeEndpointIDs(config, activationState).map(providerIDForEndpoint)
      await Promise.allSettled(
        providers.map((provider) =>
          ctx.modelRegistry.refresh({ providers: [provider], force: true }),
        ),
      )
    })
  })

  pi.on("session_shutdown", async () => {
    stopPolling?.()
    stopPolling = undefined
  })
}
