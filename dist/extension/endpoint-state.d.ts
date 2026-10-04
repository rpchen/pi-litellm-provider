/**
 * Canonical endpoint state model: desired × validation × credential × applied.
 *
 * Pure module — no Pi host imports. Every user-visible surface (management list,
 * endpoint detail, /litellm-diagnostics, audit export) derives its labels from
 * the same `userVisibleStatus(state)` so no view can drift from runtime truth.
 *
 * Product rule (frozen): 配置表达用户意图，runtime 表达现实；UI 必须诚实展示两者，
 * /models 只承诺现实（`canPublish`）。
 */
export type DesiredState = "enabled" | "disabled";
export type ValidationState = {
    readonly kind: "ok";
} | {
    readonly kind: "invalid";
    readonly reason: string;
};
export type CredentialState = "stored" | "environment" | "none" | "unknown";
/**
 * Categories surfaced to the user. `cancelled` is host lifecycle, not a failure;
 * it never overwrites a previous terminal state.
 */
export type ApplyErrorCategory = "credential-missing" | "config-invalid" | "auth" | "network" | "parse" | "cancelled";
export type AppliedState = {
    readonly kind: "active";
    readonly lastDiscoveryAt?: string;
    readonly modelCount: number;
} | {
    readonly kind: "not-applied";
} | {
    readonly kind: "error";
    readonly category: ApplyErrorCategory;
    readonly message?: string;
    readonly at?: string;
};
export interface EndpointState {
    readonly endpointId: string;
    readonly desired: DesiredState;
    readonly validation: ValidationState;
    readonly credential: CredentialState;
    readonly applied: AppliedState;
}
export type UserVisibleStatus = "disabled" | "disabled-invalid" | "enabled-active" | "enabled-needs-authentication" | "enabled-not-applied" | "enabled-error" | "enabled-invalid-configuration";
export declare function userVisibleStatus(state: EndpointState): UserVisibleStatus;
export declare function statusLabel(status: UserVisibleStatus): string;
export declare function credentialLabel(state: CredentialState): string;
export declare function applyErrorLabel(category: ApplyErrorCategory): string;
/**
 * Frozen `/models` predicate: only endpoints that are enabled, valid
 * and have a resolvable credential MAY publish models. An `applied.kind = active`
 * result confirms at least one successful refresh exists; without it no model
 * appears in `/models`, regardless of persisted snapshots.
 */
export declare function canPublish(state: EndpointState): boolean;
/**
 * Whether the snapshot-restore branch (no network) is allowed for this endpoint.
 * Same gates as `canPublish`, minus the `applied.kind = active` requirement —
 * restore exists precisely when no successful refresh has run yet in this process.
 */
export declare function canRestoreSnapshot(state: EndpointState): boolean;
/** Whether Retry / Apply again is offered in endpoint detail for this state. */
export declare function canRetry(state: EndpointState): boolean;
/** Initial applied state: a fresh process has not yet applied anything. */
export declare const INITIAL_APPLIED: AppliedState;
export declare function initialEndpointState(endpointId: string, desired: DesiredState, validation: ValidationState, credential: CredentialState): EndpointState;
