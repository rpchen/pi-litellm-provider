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
import { loadConfig, type ExtensionConfig } from "./config.ts"
import { refreshProviderModels, type DiscoveryDeps } from "./discovery.ts"
import { PROVIDER_ID } from "./provider-id.ts"
import type { ProviderConfigLike, RefreshModelsContextLike } from "./types.ts"

export { PROVIDER_ID }

/** Build the provider config for the current config snapshot. */
export function buildProviderConfig(
  getConfig: () => ExtensionConfig,
  deps?: DiscoveryDeps,
): ProviderConfigLike {
  return {
    name: "LiteLLM",
    baseUrl: getConfig().baseUrl,
    // The host resolves this reference through its own auth chain: a `/login` stored
    // credential wins, then the LITELLM_API_KEY environment variable.
    apiKey: "$LITELLM_API_KEY",
    models: [],
    refreshModels: (context: RefreshModelsContextLike) => refreshProviderModels(getConfig(), context, deps),
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
  register(pi, buildProviderConfig(() => config, internals.deps))

  let stopPolling: (() => void) | undefined

  pi.on("session_start", async (_event, ctx) => {
    // Re-read configuration so config edits and `/reload` are picked up, then keep the
    // registered provider in sync (baseUrl may have changed).
    config = resolveConfig(ctx.cwd)
    register(pi, buildProviderConfig(() => config, internals.deps))

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
