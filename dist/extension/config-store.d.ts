export type ConfigErrorCode = "parse" | "shape" | "duplicate" | "invalid-id" | "invalid-url" | "not-found" | "conflict" | "env-managed" | "legacy-conflict";
export declare class ConfigStoreError extends Error {
    readonly code: ConfigErrorCode;
    constructor(code: ConfigErrorCode, message: string);
}
export type ConfigMutation = {
    kind: "add";
    id: string;
    baseUrl: string;
} | {
    kind: "edit";
    id: string;
    baseUrl: string;
} | {
    kind: "delete";
    id: string;
};
export interface MutationOutcome {
    /** Legacy top-level baseUrl/protocolOverrides were moved into `endpoints.default`. */
    migratedLegacy: boolean;
    /** The migrated legacy address came from LITELLM_BASE_URL. */
    fromEnvironment: boolean;
}
export interface MutateOptions {
    env?: Record<string, string | undefined>;
    rename?: (from: string, to: string) => void;
    /** Test seam: runs after the mutation is computed and before the conflict check. */
    beforeCommit?: () => void;
}
type Raw = Record<string, unknown>;
export declare function validateEndpointId(id: string): string | undefined;
export type UrlCheck = {
    ok: true;
    value: string;
} | {
    ok: false;
    message: string;
};
export declare function validateBaseUrl(raw: string): UrlCheck;
export interface ConfigInspection {
    mode: "explicit" | "legacy";
    /** Every id present in the file (including entries the loader would skip), so duplicates are caught. */
    ids: string[];
}
export declare function inspectConfig(path: string, env?: Record<string, string | undefined>): ConfigInspection;
export declare function applyMutation(raw: Raw, mutation: ConfigMutation, env?: Record<string, string | undefined>): {
    next: Raw;
    outcome: MutationOutcome;
};
export declare function mutateConfig(path: string, mutation: ConfigMutation, options?: MutateOptions): Promise<MutationOutcome>;
export {};
