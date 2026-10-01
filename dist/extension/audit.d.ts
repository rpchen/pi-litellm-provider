import type { ProviderModelConfigLike } from "./types.ts";
export interface AuditEndpointInput {
    readonly id: string;
    readonly providerId: string;
    readonly status: string;
    readonly models: readonly ProviderModelConfigLike[];
}
export interface AuditModelRecord {
    readonly id: string;
    readonly name: string;
    readonly api?: string;
    readonly reasoning: boolean;
    readonly thinkingLevelMap?: Partial<Record<string, string | null>>;
    readonly input: readonly ("text" | "image")[];
    readonly cost: {
        readonly input: number;
        readonly output: number;
        readonly cacheRead: number;
        readonly cacheWrite: number;
    };
    readonly contextWindow: number;
    readonly maxTokens: number;
}
export declare function createAuditReport(endpoints: readonly AuditEndpointInput[], now?: Date): object;
