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
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type ExtensionConfig } from "./config.ts";
import { type DiscoveryDeps } from "./discovery.ts";
import { PROVIDER_ID } from "./provider-id.ts";
import type { ProviderConfigLike } from "./types.ts";
export { PROVIDER_ID };
/**
 * Normalize an address for provider-level registration (spec: 注册的配置包含规范化的
 * baseUrl). Unnormalizable input (non-http(s), userinfo, malformed) registers as an
 * empty baseUrl: discovery separately reports the configuration error and registers no
 * models, so the host never sees a provider pointing at a dead scheme.
 */
export declare function normalizedProviderBaseUrl(raw: string): string;
/** Build the provider config for the current config snapshot. */
export declare function buildProviderConfig(getConfig: () => ExtensionConfig, deps?: DiscoveryDeps): ProviderConfigLike;
/**
 * Start a poll loop calling `refresh` every `pollIntervalSeconds`. Returns an idempotent
 * stop function. The timer is unref'd so it never keeps the process alive on its own.
 */
export declare function startPolling(pollIntervalSeconds: number, refresh: () => Promise<void>): () => void;
/** Optional injection point for tests; production calls the factory with `pi` only. */
export interface FactoryInternals {
    config?: ExtensionConfig;
    deps?: DiscoveryDeps;
    /** Override the initial working directory used to resolve project config. */
    cwd?: string;
}
/** Pi extension factory. */
export default function piLitellmProvider(pi: ExtensionAPI, internals?: FactoryInternals): void;
