/**
 * Pi extension factory and PR9 global endpoint orchestration.
 *
 * Discovery remains single-endpoint internally. This adapter creates one independent
 * provider/diagnostics/coordinator/poll lifecycle for every active endpoint.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type EndpointActivation } from "./activation.ts";
import { type EndpointRegistryConfig, type ExtensionConfig } from "./config.ts";
import { type ProviderDiagnosticsState } from "./diagnostics.ts";
import { type DiscoveryDeps } from "./discovery.ts";
import { PROVIDER_ID, providerIdForEndpoint, providerNameForEndpoint } from "./provider-id.ts";
import type { ProviderConfigLike } from "./types.ts";
export { PROVIDER_ID, providerIdForEndpoint, providerNameForEndpoint };
export declare function normalizedProviderBaseUrl(raw: string): string;
export declare function buildProviderConfig(getConfig: () => ExtensionConfig, deps?: DiscoveryDeps, diagnosticsState?: ProviderDiagnosticsState, endpointId?: string): ProviderConfigLike;
export declare function startPolling(pollIntervalSeconds: number, refresh: () => Promise<void>): () => void;
export interface FactoryInternals {
    /** Legacy single-endpoint test injection. */
    config?: ExtensionConfig;
    /** PR9 registry injection. */
    registry?: EndpointRegistryConfig;
    activation?: EndpointActivation;
    activationFile?: string;
    deps?: DiscoveryDeps;
    cwd?: string;
}
export default function piLitellmProvider(pi: ExtensionAPI, internals?: FactoryInternals): void;
