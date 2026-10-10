import type { DegradationAcknowledgement, DiscoveryCacheDiagnostics, DiscoveryDiagnostics, LastKnownGoodStore } from "../core/index.ts";
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
export interface PublicationWithheldReason {
    readonly code: string;
    readonly message: string;
    readonly fields: readonly string[];
}
/** One model that could not be safely published, with every reason. */
export interface PublicationWithheldModel {
    readonly id: string;
    readonly status: string;
    readonly reasons: readonly PublicationWithheldReason[];
    /** True when the previously applied catalog published this model. */
    readonly previouslyPublished: boolean;
    /** True when a retry could plausibly obtain trustworthy facts. */
    readonly retryable: boolean;
}
/** A field-level evidence fact worth showing to the user. */
export interface PublicationFieldFact {
    readonly model: string;
    readonly field: string;
    readonly status: string;
    readonly resolution: string;
}
/** Adapter-visible slice of the Core publication + catalog partition. */
export interface PublicationSummary {
    readonly discovered: number;
    readonly publishable: readonly PublicationModelState[];
    /** Models published from a previously verified trusted snapshot. */
    readonly lkgIDs: readonly string[];
    readonly lkgDetail?: string;
    readonly withheld: readonly PublicationWithheldModel[];
    /** Some models publishable, some withheld. */
    readonly partial: boolean;
    /** Discovered models exist and none can be safely published. */
    readonly unusable: boolean;
    /** Withheld models the previous applied catalog published. */
    readonly regressions: readonly string[];
    /** Differences authority already resolved (model stays publishable). */
    readonly discrepancies: readonly PublicationFieldFact[];
    /** Genuine conflicts that withhold a model. */
    readonly conflicts: readonly PublicationFieldFact[];
    readonly failureKind?: string;
    /**
     * Notification/acknowledgement state. This only decides whether to
     * surface the current problem set again; it never changes which models
     * are publishable.
     */
    readonly acknowledgement: {
        readonly notify: boolean;
        readonly reason: string;
        readonly fingerprint: string;
    };
}
/**
 * Per-endpoint publication controller.
 *
 * `previouslyPublished` and `acknowledgement` are reporting state only:
 * neither participates in `publishable(model)`, which Core decides alone.
 */
export interface PublicationController {
    readonly store: LastKnownGoodStore;
    /** Model ids the previously applied catalog published. */
    previouslyPublished: Set<string>;
    acknowledgement?: DegradationAcknowledgement;
    /** Unconsumed user-facing notice derived from the acknowledgement decision. */
    pendingNotice?: {
        readonly reason: string;
        readonly message: string;
    };
}
/** Resolve (creating on first use) the endpoint-scoped publication controller. */
export declare function publicationControllerForState(state: ProviderDiagnosticsState | undefined): PublicationController;
/** Consume a pending catalog notice exactly once. */
export declare function takePendingNotice(state: ProviderDiagnosticsState | undefined): {
    readonly reason: string;
    readonly message: string;
} | undefined;
export interface ProviderDiagnosticsState {
    current: ProviderDiagnosticSnapshot;
    publication?: PublicationController;
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
/** Render the Core publication partition: availability, withheld reasons, LKG, evidence facts. */
export declare function formatPublicationSummary(summary: PublicationSummary | undefined): string[];
/**
 * User-facing notice for a materially new or regressed availability problem.
 *
 * A first-time gap on a newly discovered model is intentionally silent
 * (diagnostics only); a regression or an unusable catalog is not.
 */
export declare function catalogNotice(summary: PublicationSummary | undefined): {
    readonly level: "info" | "warning";
    readonly message: string;
} | undefined;
/** Public metadata source and selectable reasoning levels from Core. */
export declare function formatModelDetails(discovery: DiscoveryDiagnostics | undefined, limit?: number): string[];
export declare function formatProviderDiagnostics(state: ProviderDiagnosticsState, now?: number, timezoneOffsetMinutes?: number): string;
