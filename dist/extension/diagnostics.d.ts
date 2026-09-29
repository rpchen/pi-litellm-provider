import type { DiscoveryCacheDiagnostics, DiscoveryDiagnostics } from "../core/index.ts";
export type ProviderDiagnosticStatus = "idle" | "restored" | "ready" | "stale" | "empty" | "unconfigured" | "inactive" | "credential-missing" | "auth-error" | "config-error" | "error";
export interface ProviderDiagnosticSnapshot {
    readonly status: ProviderDiagnosticStatus;
    readonly modelCount: number;
    readonly discovery?: DiscoveryDiagnostics;
    readonly cache?: DiscoveryCacheDiagnostics;
    readonly lastSuccessfulDiscoveryAt?: string;
    readonly note?: string;
}
export interface ProviderDiagnosticsState {
    current: ProviderDiagnosticSnapshot;
}
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
export declare function formatProviderDiagnostics(state: ProviderDiagnosticsState, now?: number, timezoneOffsetMinutes?: number): string;
