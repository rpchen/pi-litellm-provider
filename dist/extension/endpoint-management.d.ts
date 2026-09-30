import type { EndpointActivation } from "./activation.ts";
import { type EndpointRegistryConfig } from "./config.ts";
import { ConfigStoreError } from "./config-store.ts";
export interface ManagementContext {
    ui: {
        select(title: string, options: string[]): Promise<string | undefined>;
        confirm(title: string, message: string): Promise<boolean>;
        input(title: string, placeholder?: string): Promise<string | undefined>;
        notify(message: string, type?: "info" | "warning" | "error"): void;
    };
    modelRegistry: {
        refresh(input: {
            providers: string[];
            force: boolean;
        }): Promise<unknown>;
    };
}
export interface ManagementHost {
    agentDir: string;
    configPath: string;
    env: Record<string, string | undefined>;
    /** Re-read litellm.json + activation from disk (skipped for injected test state). */
    reload(): void;
    registry(): EndpointRegistryConfig;
    activation(): EndpointActivation;
    persistActivation(next: EndpointActivation): void;
    /** Re-register providers / polling to match registry + activation. */
    sync(ctx: ManagementContext): void;
    /** Drop in-memory diagnostics for a deleted endpoint. */
    forget(endpointId: string): void;
}
export declare function createEndpointManager(host: ManagementHost): {
    run: (args: string, ctx: ManagementContext) => Promise<void>;
};
export { ConfigStoreError };
