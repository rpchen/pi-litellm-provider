/**
 * Discovery entry point behind pi's `refreshModels`.
 *
 * Implements design D5/D6:
 *  - restore phase (`allowNetwork` false) replays the host-persisted catalog
 *  - network phase performs real discovery and persists the result via `publish`
 *  - failure classification: network/parse/redirect/ratelimit/server/404-exhausted throw
 *    (host keeps the last good catalog); 401/403 and the no-address case return an empty list
 *  - successful results (including empty ones) are persisted so removals survive restarts
 *
 * The API key comes from the host-resolved credential when present, falling back to the
 * host's own `apiKey` reference resolution (which we cannot observe here). A missing key
 * is treated as "not configured": no network request, empty list.
 */
import { type CatalogPublication, type DiscoveryCoordinator, type DiscoveryDiagnostics, type LastKnownGoodStore, type ModelSpec } from "../core/index.ts";
import { type FetchLike } from "../net/fetch.ts";
import type { ExtensionConfig } from "./config.ts";
import { type ProviderDiagnosticsState, type PublicationSummary } from "./diagnostics.ts";
import type { AppliedState } from "./endpoint-state.ts";
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
    /**
     * Publication controller override (tests). Production resolves it from
     * the per-endpoint diagnostics state so degraded acceptance and the LKG
     * store survive across refreshes of the same provider instance.
     */
    publication?: {
        readonly store?: LastKnownGoodStore;
        /** Model ids the previously applied catalog published (regression baseline). */
        readonly previouslyPublished?: ReadonlySet<string>;
        readonly now?: number;
    };
    /**
     * Applied-state sink: the canonical state writer invoked on every terminal
     * outcome of this refresh (success → active, category-tagged error → error).
     * Absent means "no canonical state writer" (legacy/discovery-only callers).
     */
    appliedWriter?: (next: AppliedState) => void;
}
/** Result of one network-phase discovery, before persistence. */
export interface DiscoveryOutcome {
    models: ProviderModelConfigLike[];
    specs: ModelSpec[];
    /**
     * Specs persisted into the snapshot. They are exactly the published set:
     * there is no degraded or withheld model in a persisted snapshot.
     */
    snapshotSpecs: ModelSpec[];
    fingerprint: string;
    diagnostics: DiscoveryDiagnostics;
    publication: PublicationSummary;
    catalog: CatalogPublication;
}
export type ProviderRefreshCoordinator = DiscoveryCoordinator<DiscoveryOutcome>;
/** Create one coordinator per registered provider instance. */
export declare function createProviderRefreshCoordinator(): ProviderRefreshCoordinator;
/**
 * Run the network phase: contact LiteLLM, enrich from models.dev, build specs and map to
 * pi provider configs. Throws `DiscoveryError` on degradable failures.
 *
 * Publication partition comes from Core `buildPublicationResult`: only
 * `configured` and `configured-lkg` models map to provider configs. A
 * models.dev fetch failure does not abort discovery; it is classified with
 * the Core taxonomy so valid LKG entries can substitute while the rest stay
 * withheld with reasons. One model's failure never gates another's.
 */
export declare function discoverModels(config: ExtensionConfig, apiKey: string, signal: AbortSignal | undefined, deps?: DiscoveryDeps): Promise<DiscoveryOutcome>;
/**
 * `refreshModels` callback body.
 *
 * Returns the model list the host should register for this provider. See the module
 * comment for the phase/failure semantics.
 */
export declare function refreshProviderModels(config: ExtensionConfig, context: RefreshModelsContextLike, deps?: DiscoveryDeps, coordinator?: ProviderRefreshCoordinator, diagnosticsState?: ProviderDiagnosticsState): Promise<ProviderModelConfigLike[]>;
