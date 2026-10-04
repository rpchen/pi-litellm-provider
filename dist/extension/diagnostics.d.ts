import type { DiscoveryCacheDiagnostics, DiscoveryDiagnostics, LastKnownGoodStore } from "../core/index.ts";
import type { ProviderModelConfigLike } from "./types.ts";
export type ProviderDiagnosticStatus = "idle" | "restored" | "ready" | "stale" | "empty" | "unconfigured" | "inactive" | "credential-missing" | "auth-error" | "config-error" | "error";
export interface ProviderDiagnosticSnapshot {
    readonly status: ProviderDiagnosticStatus;
    readonly modelCount: number;
    readonly discovery?: DiscoveryDiagnostics;
    readonly publication?: PublicationSummary;
    readonly cache?: DiscoveryCacheDiagnostics;
    readonly lastSuccessfulDiscoveryAt?: string;
    readonly note?: string;
    /** Last registered provider models (allowlisted shape); used by audit export. */
    readonly models?: readonly ProviderModelConfigLike[];
}
export interface PublicationModelState {
    readonly id: string;
    readonly status: string;
}
export interface PublicationBlockedModel {
    readonly id: string;
    readonly status: string;
    readonly gaps: readonly string[];
    /** Core eligibility. Adapters must not re-derive this from status strings. */
    readonly degradationEligible: boolean;
    readonly degradationReason?: string;
}
/** Adapter-visible slice of the Core publication partition (no policy logic). */
export interface PublicationSummary {
    readonly publishable: readonly PublicationModelState[];
    readonly degradedIDs: readonly string[];
    readonly lkgIDs: readonly string[];
    readonly blocked: readonly PublicationBlockedModel[];
    readonly failureKind?: string;
}
/** Per-endpoint publication controller: LKG store + degraded acceptance. */
export interface PublicationController {
    readonly store: LastKnownGoodStore;
    readonly acceptedDegradedIDs: Set<string>;
}
export interface ProviderDiagnosticsState {
    current: ProviderDiagnosticSnapshot;
    publication?: PublicationController;
}
/** Resolve (creating on first use) the endpoint-scoped publication controller. */
export declare function publicationControllerForState(state: ProviderDiagnosticsState | undefined): PublicationController;
export declare function createProviderDiagnosticsState(): ProviderDiagnosticsState;
export declare function setProviderDiagnostics(state: ProviderDiagnosticsState | undefined, snapshot: ProviderDiagnosticSnapshot): void;
export declare function runtimeBuildInfo(): {
    pluginVersion: string;
    coreSHA: string;
    coreBranch: string;
};
/**
 * Format an instant in the timezone configured on the running host.
 *
 * Internal discovery state remains UTC/epoch based. The optional offset is only
 * for deterministic tests; production callers omit it and use the host timezone.
 */
export declare function formatHostDateTime(value: string | number | Date, timezoneOffsetMinutes?: number): string;
/** Render the Core publication partition: states, gaps, LKG, degraded. */
export declare function formatPublicationSummary(summary: PublicationSummary | undefined): string[];
export declare function formatProviderDiagnostics(state: ProviderDiagnosticsState, now?: number, timezoneOffsetMinutes?: number): string;
