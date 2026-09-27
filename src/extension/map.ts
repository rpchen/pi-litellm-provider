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
import type { ModelSpec } from "../core/index.ts"
import type { ProviderModelConfigLike, ThinkingLevel } from "./types.ts"

/** LiteLLM protocol → pi-ai API id. */
export const PROTOCOL_API: Readonly<Record<"chat" | "responses" | "messages", string>> = {
  chat: "openai-completions",
  responses: "openai-responses",
  messages: "anthropic-messages",
}

/** All pi thinking levels, in display order. */
const ALL_LEVELS: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"]

/**
 * Build the thinkingLevelMap for a model spec (design D4).
 *
 * pi resolves selectable levels via `getSupportedThinkingLevels`: `null` hides a level,
 * and `xhigh`/`max` are only offered when explicitly present. Budget-token variants
 * (Messages) select `high`/`max`; the token amounts come from pi's own thinkingBudgets,
 * not from this map -- the registration API has no per-model budget channel.
 */
export function thinkingLevelMapFor(spec: ModelSpec): Partial<Record<ThinkingLevel, string | null>> | undefined {
  if (spec.variants.length === 0) return undefined

  const variantIDs = new Set(spec.variants.map((variant) => variant.id))
  const isBudget = spec.variants.some((variant) => variant.id === "high" && "thinking" in variant.settings)

  const map: Partial<Record<ThinkingLevel, string | null>> = {}
  if (isBudget) {
    // Budget-token variants: only the high/max levels produced by the core are selectable.
    // `off` must stay absent (not null): a null value would hide "thinking off" in the
    // picker and block the disabled-thinking request path (spec: off 不写键).
    for (const level of ALL_LEVELS) {
      if (level === "off") continue
      if (level === "high" || level === "max") {
        map[level] = variantIDs.has(level) ? level : null
      } else {
        map[level] = null
      }
    }
    return map
  }

  // Effort variants: each core variant name maps onto the same-named pi level; `none` is
  // pi's `off`. Everything the record did not declare is hidden.
  for (const level of ALL_LEVELS) {
    if (variantIDs.has(level)) {
      map[level] = level
    } else if (level === "off" && variantIDs.has("none")) {
      map[level] = "none"
    } else {
      map[level] = null
    }
  }
  return map
}

/** Core modality vocabulary → pi's `("text" | "image")[]`, preserving declaration order. */
function toPiInput(modalities: readonly string[]): ("text" | "image")[] {
  const result: ("text" | "image")[] = []
  for (const modality of modalities) {
    if (modality === "text" || modality === "image") result.push(modality)
  }
  // pi requires text support on every conversational model.
  if (!result.includes("text")) result.unshift("text")
  return result
}

/**
 * Map discovery specs to pi provider model configs.
 *
 * `rootURL` is the normalized LiteLLM root (no `/v1`); each model's baseUrl is derived
 * per protocol.
 */
export function toProviderModels(specs: readonly ModelSpec[], rootURL: string): ProviderModelConfigLike[] {
  const apiBase = `${rootURL}/v1`
  return specs.map((spec) => {
    const model: ProviderModelConfigLike = {
      id: spec.id,
      name: spec.name,
      api: PROTOCOL_API[spec.protocol],
      baseUrl: spec.protocol === "messages" ? rootURL : apiBase,
      reasoning: spec.variants.length > 0,
      input: toPiInput(spec.capabilities.input),
      cost: spec.cost,
      contextWindow: spec.limit.context,
      maxTokens: spec.limit.output,
    }
    const thinkingLevelMap = thinkingLevelMapFor(spec)
    return thinkingLevelMap ? { ...model, thinkingLevelMap } : model
  })
}
