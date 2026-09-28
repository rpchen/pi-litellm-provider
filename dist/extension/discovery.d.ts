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
import { type DiscoveryCoordinator, type DiscoveryDiagnostics, type ModelSpec } from "../core/index.ts";
import { type FetchLike } from "../net/fetch.ts";
import type { ExtensionConfig } from "./config.ts";
import { type ProviderDiagnosticsState } from "./diagnostics.ts";
import type { ProviderModelConfigLike, RefreshModelsContextLike } from "./types.ts";
export interface DiscoveryLogger {
    warn(message: string): void;
    error(message: string): void;
}
export interface DiscoveryDeps {
    fetchImpl?: FetchLike;
    logger?: DiscoveryLogger;
    /** Override models.dev catalog source (tests); production uses the shared cache. */
    loadModelsDevCatalog?: (signal?: AbortSignal) => Promise<unknown>;
}
/** Result of one network-phase discovery, before persistence. */
export interface DiscoveryOutcome {
    models: ProviderModelConfigLike[];
    specs: ModelSpec[];
    fingerprint: string;
    diagnostics: DiscoveryDiagnostics;
}
export type ProviderRefreshCoordinator = DiscoveryCoordinator<DiscoveryOutcome>;
/** Create one coordinator per registered provider instance. */
export declare function createProviderRefreshCoordinator(): ProviderRefreshCoordinator;
/**
 * Run the network phase: contact LiteLLM, enrich from models.dev, build specs and map to
 * pi provider configs. Throws `DiscoveryError` on degradable failures.
 */
export declare function discoverModels(config: ExtensionConfig, apiKey: string, signal: AbortSignal | undefined, deps?: DiscoveryDeps): Promise<DiscoveryOutcome>;
/**
 * `refreshModels` callback body.
 *
 * Returns the model list the host should register for this provider. See the module
 * comment for the phase/failure semantics.
 */
export declare function refreshProviderModels(config: ExtensionConfig, context: RefreshModelsContextLike, deps?: DiscoveryDeps, coordinator?: ProviderRefreshCoordinator, diagnosticsState?: ProviderDiagnosticsState): Promise<ProviderModelConfigLike[]>;
