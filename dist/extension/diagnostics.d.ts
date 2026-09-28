import type { DiscoveryCacheDiagnostics, DiscoveryDiagnostics } from "../core/index.ts";
export type ProviderDiagnosticStatus = "idle" | "restored" | "ready" | "stale" | "empty" | "unconfigured" | "auth-error" | "config-error" | "error";
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
export declare function formatProviderDiagnostics(state: ProviderDiagnosticsState, now?: number): string;
