/**
 * Translation seam between the host-independent discovery core and pi's provider config.
 *
 * The independent litellm-discovery-core produces host-neutral model specs.
 * This module owns the only host-specific mapping:
 *  - LiteLLM protocol → pi-ai API id
 *  - ModelSpec → ProviderModelConfig, including thinkingLevelMap translation
 *  - per-model baseUrl: chat/responses use `{root}/v1`, messages uses `{root}` because
 *    `@anthropic-ai/sdk` appends `/v1/messages` itself (see design D3).
 */
import { type ModelSpec, type PublishableEntry } from "../core/index.ts";
import type { ProviderModelConfigLike, ThinkingLevel } from "./types.ts";
/** LiteLLM protocol → pi-ai API id. */
export declare const PROTOCOL_API: Readonly<Record<"chat" | "responses" | "messages", string>>;
/**
 * Build the thinkingLevelMap for a model spec (design D4).
 *
 * pi resolves selectable levels via `getSupportedThinkingLevels`: `null` hides a level,
 * and `xhigh`/`max` are only offered when explicitly present. Budget-token variants
 * (Messages) select `high`/`max`; the token amounts come from pi's own thinkingBudgets,
 * not from this map -- the registration API has no per-model budget channel.
 */
export declare function thinkingLevelMapFor(spec: ModelSpec): Partial<Record<ThinkingLevel, string | null>> | undefined;
/**
 * Whether the host model should advertise reasoning.
 *
 * Follows the Core verdict when present: `supported` (even with zero
 * selectable levels) maps to true; `unsupported` and `unknown` map to
 * false. Specs predating the Core verdict field keep the legacy
 * variant-count inference.
 */
export declare function reasoningForHost(spec: ModelSpec): boolean;
/**
 * Map discovery specs to pi provider model configs.
 *
 * `rootURL` is the normalized LiteLLM root (no `/v1`); each model's baseUrl is derived
 * per protocol. Only Core-publishable entries should be passed (see
 * `toProviderModelsWithPublication`); the operational-limits guard stays
 * as adapter-side defense in depth.
 */
export declare function toProviderModels(specs: readonly ModelSpec[], rootURL: string): ProviderModelConfigLike[];
/**
 * Map Core publication entries to pi provider model configs.
 *
 * Consumes the Core partition without reimplementing policy: only
 * entries Core reports publishable (configured, configured-lkg,
 * user-accepted degraded) are passed in. Degraded entries map to the
 * same provider shape with conservative flags; their degraded state
 * stays visible through diagnostics, never re-labeled as configured.
 */
export declare function toProviderModelsWithPublication(entries: readonly PublishableEntry[], rootURL: string): ProviderModelConfigLike[];
