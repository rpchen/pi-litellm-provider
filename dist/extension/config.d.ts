export type ConfigProtocol = "chat" | "responses" | "messages";
export interface ExtensionConfig {
    baseUrl: string;
    pollInterval: number;
    contextTierCap: boolean;
    protocolOverrides: Record<string, ConfigProtocol>;
    globalConfigPath: string;
    /** Kept for discovery/test compatibility; PR9 no longer reads project config. */
    projectConfigPath: string;
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
