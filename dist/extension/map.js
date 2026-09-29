/** LiteLLM protocol → pi-ai API id. */
export const PROTOCOL_API = {
    chat: "openai-completions",
    responses: "openai-responses",
    messages: "anthropic-messages",
};
/** All pi thinking levels, in display order. */
const ALL_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
/**
 * Build the thinkingLevelMap for a model spec (design D4).
 *
 * pi resolves selectable levels via `getSupportedThinkingLevels`: `null` hides a level,
 * and `xhigh`/`max` are only offered when explicitly present. Budget-token variants
 * (Messages) select `high`/`max`; the token amounts come from pi's own thinkingBudgets,
 * not from this map -- the registration API has no per-model budget channel.
 */
export function thinkingLevelMapFor(spec) {
    if (spec.variants.length === 0)
        return undefined;
    const variantIDs = new Set(spec.variants.map((variant) => variant.id));
    const isBudget = spec.variants.some((variant) => variant.id === "high" && "thinking" in variant.settings);
    const map = {};
    if (isBudget) {
        // Budget-token variants: only the high/max levels produced by the core are selectable.
        // `off` must stay absent (not null): a null value would hide "thinking off" in the
        // picker and block the disabled-thinking request path (spec: off 不写键).
        for (const level of ALL_LEVELS) {
            if (level === "off")
                continue;
            if (level === "high" || level === "max") {
                map[level] = variantIDs.has(level) ? level : null;
            }
            else {
                map[level] = null;
            }
        }
        return map;
    }
    // Effort variants: each core variant name maps onto the same-named pi level; `none` is
    // pi's `off`. Everything the record did not declare is hidden.
    for (const level of ALL_LEVELS) {
        if (variantIDs.has(level)) {
            map[level] = level;
        }
        else if (level === "off" && variantIDs.has("none")) {
            map[level] = "none";
        }
        else {
            map[level] = null;
        }
    }
    return map;
}
/** Core modality vocabulary → pi's `("text" | "image")[]`, preserving declaration order. */
function toPiInput(modalities) {
    const result = [];
    for (const modality of modalities) {
        if (modality === "text" || modality === "image")
            result.push(modality);
    }
    // pi requires text support on every conversational model.
    if (!result.includes("text"))
        result.unshift("text");
    return result;
}
/**
 * Map discovery specs to pi provider model configs.
 *
 * `rootURL` is the normalized LiteLLM root (no `/v1`); each model's baseUrl is derived
 * per protocol.
 */
export function hasOperationalLimits(spec) {
    return spec.limit.context > 0 && spec.limit.output > 0;
}
export function toProviderModels(specs, rootURL) {
    const apiBase = `${rootURL}/v1`;
    return specs.filter(hasOperationalLimits).map((spec) => {
        const model = {
            id: spec.id,
            name: spec.name,
            api: PROTOCOL_API[spec.protocol],
            baseUrl: spec.protocol === "messages" ? rootURL : apiBase,
            reasoning: spec.variants.length > 0,
            input: toPiInput(spec.capabilities.input),
            cost: spec.cost,
            contextWindow: spec.limit.context,
            maxTokens: spec.limit.output,
        };
        const thinkingLevelMap = thinkingLevelMapFor(spec);
        return thinkingLevelMap ? { ...model, thinkingLevelMap } : model;
    });
}
