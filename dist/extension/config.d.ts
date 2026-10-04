import type { ValidationState } from "./endpoint-state.ts";
export type ConfigProtocol = "chat" | "responses" | "messages";
export interface ExtensionConfig {
    /** Present only for explicit multi-endpoint mode; legacy single-endpoint keeps this undefined. */
    endpointId?: string;
    baseUrl: string;
    pollInterval: number;
    contextTierCap: boolean;
    protocolOverrides: Record<string, ConfigProtocol>;
    globalConfigPath: string;
    /** Kept for discovery/test compatibility; PR9 no longer reads project config. */
    projectConfigPath: string;
    /**
       * Endpoint definition validation. `invalid` means the user's definition is
       * malformed (bad URL/userinfo/etc.); runtime apply refuses the endpoint and
       * the canonical state translates it into Enabled/Disabled · Invalid configuration.
       * A missing credential is NOT a validation failure.
       * When absent (legacy test fixtures), the effective value is `{ kind: "ok" }`.
       */
    validation?: ValidationState;
}
export interface EndpointRegistryConfig {
    readonly mode: "legacy" | "explicit";
    readonly endpoints: Readonly<Record<string, ExtensionConfig>>;
    readonly globalConfigPath: string;
}
export declare const DEFAULT_POLL_INTERVAL_SECONDS = 300;
export declare const MIN_POLL_INTERVAL_SECONDS = 30;
export declare const DEFAULT_ENDPOINT_ID = "default";
export interface ConfigLogger {
    warn(message: string): void;
}
export declare function isEndpointId(value: string): boolean;
export declare function loadEndpointRegistry(_cwd: string, logger?: ConfigLogger, env?: Record<string, string | undefined>, agentDir?: string): EndpointRegistryConfig;
/** Legacy helper retained for discovery-level callers/tests. */
export declare function loadConfig(cwd: string, logger?: ConfigLogger, env?: Record<string, string | undefined>, agentDir?: string): ExtensionConfig;
export declare function isConfigured(config: ExtensionConfig): boolean;
