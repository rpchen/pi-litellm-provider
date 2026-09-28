/**
 * Pi extension factory.
 *
 * Registers the `litellm` provider at factory time (participating in startup model
 * selection and `pi --list-models`) and owns the discovery poll lifecycle:
 *
 *  - `registerProvider("litellm", …)`: apiKey is the host-resolved `$LITELLM_API_KEY`
 *    reference (with `/login` stored credentials taking precedence inside pi's auth chain);
 *    baseUrl comes from config (env or `litellm.json`).
 *  - `refreshModels`: delegates to `refreshProviderModels` (restore/network phases).
 *  - `session_start`: starts the poll loop, which asks the host to refresh this provider
 *    via `ctx.modelRegistry.refresh({ providers, force: true })` instead of re-registering.
 *  - `session_shutdown`: idempotent teardown.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { normalizeLiteLLMURL } from "../core/index.ts"
import { loadConfig, type ExtensionConfig } from "./config.ts"
import {
  createProviderDiagnosticsState,
  formatProviderDiagnostics,
  type ProviderDiagnosticsState,
} from "./diagnostics.ts"
import { createProviderRefreshCoordinator, refreshProviderModels, type DiscoveryDeps } from "./discovery.ts"
import { PROVIDER_ID } from "./provider-id.ts"
import type { ProviderConfigLike, RefreshModelsContextLike } from "./types.ts"

export { PROVIDER_ID }

/**
 * Normalize an address for provider-level registration (spec: 注册的配置包含规范化的
 * baseUrl). Unnormalizable input (non-http(s), userinfo, malformed) registers as an
 * empty baseUrl: discovery separately reports the configuration error and registers no
 * models, so the host never sees a provider pointing at a dead scheme.
 */
export function normalizedProviderBaseUrl(raw: string): string {
  if (raw.length === 0) return ""
  try {
    return normalizeLiteLLMURL(raw).rootURL
  } catch {
    return ""
  }
}

/** Build the provider config for the current config snapshot. */
export function buildProviderConfig(
  getConfig: () => ExtensionConfig,
  deps?: DiscoveryDeps,
  diagnosticsState: ProviderDiagnosticsState = createProviderDiagnosticsState(),
): ProviderConfigLike {
  const coordinator = createProviderRefreshCoordinator()
  return {
    name: "LiteLLM",
    baseUrl: normalizedProviderBaseUrl(getConfig().baseUrl),
    // The host resolves this reference through its own auth chain: a `/login` stored
    // credential wins, then the LITELLM_API_KEY environment variable.
    apiKey: "$LITELLM_API_KEY",
    models: [],
    refreshModels: (context: RefreshModelsContextLike) =>
      refreshProviderModels(getConfig(), context, deps, coordinator, diagnosticsState),
  }
}

/**
 * Start a poll loop calling `refresh` every `pollIntervalSeconds`. Returns an idempotent
 * stop function. The timer is unref'd so it never keeps the process alive on its own.
 */
export function startPolling(pollIntervalSeconds: number, refresh: () => Promise<void>): () => void {
  let active = true
  const timer = setInterval(() => {
    if (!active) return
    void refresh().catch(() => {
      // Refresh errors are recorded by the host; polling must keep running.
    })
  }, pollIntervalSeconds * 1000)
  timer.unref?.()
  return () => {
    if (!active) return
    active = false
    clearInterval(timer)
  }
}

/** Optional injection point for tests; production calls the factory with `pi` only. */
export interface FactoryInternals {
  config?: ExtensionConfig
  deps?: DiscoveryDeps
  /** Override the initial working directory used to resolve project config. */
  cwd?: string
}

/**
 * Register through pi's API.
 *
 * `ProviderConfigLike` is the structural subset used for unit testing without a pi
 * runtime; the cast is a type-only bridge (function-parameter variance differs).
 */
function register(pi: ExtensionAPI, config: ProviderConfigLike): void {
  pi.registerProvider(PROVIDER_ID, config as Parameters<ExtensionAPI["registerProvider"]>[1])
}

/** Pi extension factory. */
export default function piLitellmProvider(pi: ExtensionAPI, internals: FactoryInternals = {}): void {
  const resolveConfig = (cwd: string): ExtensionConfig =>
    internals.config ?? loadConfig(cwd)

  let config = resolveConfig(internals.cwd ?? process.cwd())
  const diagnosticsState = createProviderDiagnosticsState()

  pi.registerCommand("litellm-diagnostics", {
    description: "显示 LiteLLM 发现、协议、元数据来源、缓存与构建诊断",
    handler: async (_args, ctx) => {
      const status = diagnosticsState.current.status
      const level = status === "auth-error" || status === "config-error" || status === "error"
        ? "warning"
        : "info"
      ctx.ui.notify(formatProviderDiagnostics(diagnosticsState), level)
    },
  })

  register(pi, buildProviderConfig(() => config, internals.deps, diagnosticsState))

  let stopPolling: (() => void) | undefined

  pi.on("session_start", async (_event, ctx) => {
    // Re-read configuration so config edits and `/reload` are picked up, then keep the
    // registered provider in sync (baseUrl may have changed).
    config = resolveConfig(ctx.cwd)
    register(pi, buildProviderConfig(() => config, internals.deps, diagnosticsState))

    // Idempotent: a repeated session_start without shutdown must not stack timers.
    if (stopPolling) return
    stopPolling = startPolling(config.pollInterval, () =>
      ctx.modelRegistry.refresh({ providers: [PROVIDER_ID], force: true }).then(() => undefined),
    )
  })

  pi.on("session_shutdown", async () => {
    stopPolling?.()
    stopPolling = undefined
  })
}
