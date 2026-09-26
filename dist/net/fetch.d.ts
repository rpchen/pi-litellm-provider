/**
 * Host-independent HTTP fetching with timeout, error classification and key redaction.
 *
 * Pi-side network adapter for the independent discovery core. The optional external
 * AbortSignal is combined with the per-request timeout, so pi's
 * `refreshModels(context.signal)` cancellation reaches in-flight discovery requests.
 * No pi or OpenCode imports allowed in this directory.
 */
import type { LiteLLMAddresses } from "../core/index.ts";
export type DiscoveryErrorKind = "network" | "auth" | "notfound" | "ratelimit" | "server" | "parse" | "redirect";
export declare class DiscoveryError extends Error {
    readonly kind: DiscoveryErrorKind;
    readonly status?: number | undefined;
    constructor(kind: DiscoveryErrorKind, message: string, status?: number | undefined);
}
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export interface FetchJSONOptions {
    url: string;
    key?: string;
    timeoutMs: number;
    fetchImpl?: FetchLike;
    /** External cancellation (e.g. pi's refresh signal); aborts the request alongside the timeout. */
    signal?: AbortSignal;
}
export interface CacheLogger {
    warn(message: string): void;
}
export declare function redact(value: string, key?: string): string;
export declare function fetchJSON(options: FetchJSONOptions): Promise<unknown>;
export declare function fetchLiteLLMModelInfo(addresses: LiteLLMAddresses, key: string, fetchImpl?: FetchLike, signal?: AbortSignal): Promise<unknown>;
export interface ModelsDevOptions {
    fetchImpl?: FetchLike;
    now?: () => number;
    logger?: CacheLogger;
    url?: string;
    signal?: AbortSignal;
}
export declare function getModelsDevCatalog(options?: ModelsDevOptions): Promise<unknown>;
export declare function resetModelsDevCacheForTest(): void;
