/** LiteLLM protocol override value accepted by the extension configuration. */
export type ConfigProtocol = "chat" | "responses" | "messages";
/** Resolved extension configuration. `baseUrl` is empty when no source provided one. */
export interface ExtensionConfig {
    /** Raw configured address (not normalized); empty string means "not connected". */
    baseUrl: string;
    /** Seconds between discovery polls. Default 300, clamped to a 30s minimum. */
    pollInterval: number;
    /** Whether to cap context windows at the first pricing tier boundary. Default true. */
    contextTierCap: boolean;
    /** Per-model protocol overrides, keyed by LiteLLM `model_name`. */
    protocolOverrides: Record<string, ConfigProtocol>;
    /** Global config file path, exposed for diagnostics. */
    globalConfigPath: string;
    /** Project config file path, exposed for diagnostics. */
    projectConfigPath: string;
}
export declare const DEFAULT_POLL_INTERVAL_SECONDS = 300;
export declare const MIN_POLL_INTERVAL_SECONDS = 30;
export interface ConfigLogger {
    warn(message: string): void;
}
/**
 * Resolve configuration for the given working directory.
 *
 * `env` defaults to `process.env`; `agentDir` defaults to pi's agent directory, both
 * injectable for tests.
 */
export declare function loadConfig(cwd: string, logger?: ConfigLogger, env?: Record<string, string | undefined>, agentDir?: string): ExtensionConfig;
/** True when an address was resolved from any source. */
export declare function isConfigured(config: ExtensionConfig): boolean;
