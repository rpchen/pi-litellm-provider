import { normalizeLiteLLMURL } from "../core/index.js";
import { loadConfig } from "./config.js";
import { createProviderRefreshCoordinator, refreshProviderModels } from "./discovery.js";
import { PROVIDER_ID } from "./provider-id.js";
export { PROVIDER_ID };
/**
 * Normalize an address for provider-level registration (spec: 注册的配置包含规范化的
 * baseUrl). Unnormalizable input (non-http(s), userinfo, malformed) registers as an
 * empty baseUrl: discovery separately reports the configuration error and registers no
 * models, so the host never sees a provider pointing at a dead scheme.
 */
export function normalizedProviderBaseUrl(raw) {
    if (raw.length === 0)
        return "";
    try {
        return normalizeLiteLLMURL(raw).rootURL;
    }
    catch {
        return "";
    }
}
/** Build the provider config for the current config snapshot. */
export function buildProviderConfig(getConfig, deps) {
    const coordinator = createProviderRefreshCoordinator();
    return {
        name: "LiteLLM",
        baseUrl: normalizedProviderBaseUrl(getConfig().baseUrl),
        // The host resolves this reference through its own auth chain: a `/login` stored
        // credential wins, then the LITELLM_API_KEY environment variable.
        apiKey: "$LITELLM_API_KEY",
        models: [],
        refreshModels: (context) => refreshProviderModels(getConfig(), context, deps, coordinator),
    };
}
/**
 * Start a poll loop calling `refresh` every `pollIntervalSeconds`. Returns an idempotent
 * stop function. The timer is unref'd so it never keeps the process alive on its own.
 */
export function startPolling(pollIntervalSeconds, refresh) {
    let active = true;
    const timer = setInterval(() => {
        if (!active)
            return;
        void refresh().catch(() => {
            // Refresh errors are recorded by the host; polling must keep running.
        });
    }, pollIntervalSeconds * 1000);
    timer.unref?.();
    return () => {
        if (!active)
            return;
        active = false;
        clearInterval(timer);
    };
}
/**
 * Register through pi's API.
 *
 * `ProviderConfigLike` is the structural subset used for unit testing without a pi
 * runtime; the cast is a type-only bridge (function-parameter variance differs).
 */
function register(pi, config) {
    pi.registerProvider(PROVIDER_ID, config);
}
/** Pi extension factory. */
export default function piLitellmProvider(pi, internals = {}) {
    const resolveConfig = (cwd) => internals.config ?? loadConfig(cwd);
    let config = resolveConfig(internals.cwd ?? process.cwd());
    register(pi, buildProviderConfig(() => config, internals.deps));
    let stopPolling;
    pi.on("session_start", async (_event, ctx) => {
        // Re-read configuration so config edits and `/reload` are picked up, then keep the
        // registered provider in sync (baseUrl may have changed).
        config = resolveConfig(ctx.cwd);
        register(pi, buildProviderConfig(() => config, internals.deps));
        // Idempotent: a repeated session_start without shutdown must not stack timers.
        if (stopPolling)
            return;
        stopPolling = startPolling(config.pollInterval, () => ctx.modelRegistry.refresh({ providers: [PROVIDER_ID], force: true }).then(() => undefined));
    });
    pi.on("session_shutdown", async () => {
        stopPolling?.();
        stopPolling = undefined;
    });
}
