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
import type { ModelSpec } from "../core/index.ts";
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
 * Map discovery specs to pi provider model configs.
 *
 * `rootURL` is the normalized LiteLLM root (no `/v1`); each model's baseUrl is derived
 * per protocol.
 */
export declare function toProviderModels(specs: readonly ModelSpec[], rootURL: string): ProviderModelConfigLike[];
