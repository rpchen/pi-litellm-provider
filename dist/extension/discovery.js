/**
 * Discovery entry point behind pi's `refreshModels`.
 *
 * Implements design D5/D6:
 *  - restore phase (`allowNetwork` false) replays the host-persisted catalog
 *  - network phase performs real discovery and persists the result via `publish`
 *  - failure classification: network/parse/redirect/ratelimit/server/404-exhausted throw
 *    (host keeps the last good catalog); 401/403 and "not connected" return an empty list
 *  - successful results (including empty ones) are persisted so removals survive restarts
 *
 * The API key comes from the host-resolved credential when present, falling back to the
 * host's own `apiKey` reference resolution (which we cannot observe here). A missing key
 * is treated as "not configured": no network request, empty list.
 */
import { buildModelSpecs, createDiscoveryCoordinator, modelFingerprint, normalizeLiteLLMURL, } from "../core/index.js";
import { DiscoveryError, fetchLiteLLMModelInfo, getModelsDevCatalog } from "../net/fetch.js";
import { toProviderModels } from "./map.js";
/** Create one coordinator per registered provider instance. */
export function createProviderRefreshCoordinator() {
    return createDiscoveryCoordinator();
}
/**
 * Run the network phase: contact LiteLLM, enrich from models.dev, build specs and map to
 * pi provider configs. Throws `DiscoveryError` on degradable failures.
 */
export async function discoverModels(config, apiKey, signal, deps = {}) {
    const addresses = normalizeLiteLLMURL(config.baseUrl);
    const litellmResponse = await fetchLiteLLMModelInfo(addresses, apiKey, deps.fetchImpl, signal);
    const catalog = deps.loadModelsDevCatalog
        ? await deps.loadModelsDevCatalog(signal)
        : await getModelsDevCatalog({ fetchImpl: deps.fetchImpl, logger: deps.logger, signal });
    const specs = buildModelSpecs(litellmResponse, catalog, {
        contextTierCap: config.contextTierCap,
        protocolOverrides: config.protocolOverrides,
    });
    return {
        specs,
        models: toProviderModels(specs, addresses.rootURL),
        fingerprint: modelFingerprint(specs),
    };
}
/**
 * `refreshModels` callback body.
 *
 * Returns the model list the host should register for this provider. See the module
 * comment for the phase/failure semantics.
 */
export async function refreshProviderModels(config, context, deps = {}, coordinator = createProviderRefreshCoordinator()) {
    const logger = deps.logger ?? console;
    const stored = asStoredCatalog(context.stored);
    // Restore phase, or an aborted request: replay whatever the host persisted last.
    if (context.allowNetwork === false || context.signal?.aborted) {
        return stored?.models ?? [];
    }
    // Not connected: no address resolved. Tell the user how to configure one (spec:
    // 记录说明性提示) and drop the catalog so stale models disappear.
    if (config.baseUrl.length === 0) {
        logger.warn("LiteLLM 未配置地址：请设置 LITELLM_BASE_URL，或在 ~/.pi/agent/litellm.json / 项目 .pi/litellm.json 中填写 baseUrl");
        await publishIfChanged(context, stored, []);
        return [];
    }
    const apiKey = context.credential?.key;
    if (!apiKey) {
        // The host only reaches the network phase when a credential resolved; treat a missing
        // key defensively as unconfigured rather than sending an unauthenticated request.
        logger.warn("LiteLLM Key 未配置，跳过发现（请使用 /login 或设置 LITELLM_API_KEY）");
        await publishIfChanged(context, stored, []);
        return [];
    }
    const discoveryKey = `${config.baseUrl}\u0000${apiKey}`;
    try {
        const coordinated = await coordinator.refresh(discoveryKey, () => discoverModels(config, apiKey, context.signal, deps), {
            forceRefresh: context.force === true,
            failurePolicy: (error) => {
                if (context.signal?.aborted)
                    return "ignore";
                if (error instanceof DiscoveryError && error.kind === "auth")
                    return "clear";
                if (normalizeLiteLLMURLFailed(error, config.baseUrl))
                    return "clear";
                return "stale";
            },
        });
        if (context.signal?.aborted)
            return stored?.models ?? [];
        if (coordinated.source === "stale") {
            logger.warn(`LiteLLM 发现失败，使用 last-known-good：${messageOf(coordinated.error)}`);
        }
        const outcome = coordinated.value;
        await publishIfChanged(context, stored, outcome.models);
        return outcome.models;
    }
    catch (error) {
        // Host cancellation (a newer refresh superseded this one, the model selector's 15s
        // catalog budget expired, or the session is shutting down) aborts in-flight requests.
        // That is normal lifecycle, not a failure: replay the persisted baseline silently;
        // the host discards this refresh's result anyway once the signal is aborted.
        if (context.signal?.aborted) {
            return stored?.models ?? [];
        }
        if (error instanceof DiscoveryError && error.kind === "auth") {
            logger.error(`LiteLLM 认证失败，已撤下全部模型：${error.message}`);
            await publishIfChanged(context, stored, []);
            return [];
        }
        if (normalizeLiteLLMURLFailed(error, config.baseUrl)) {
            // Configuration error (not a transport failure): the address itself is unusable.
            // Spec: 记录错误、不发起发现请求、不注册模型 — so drop the catalog instead of
            // keeping stale models pointed at a dead address.
            logger.error(`LiteLLM 地址无效（${redactUrl(config.baseUrl)}）：${messageOf(error)}`);
            await publishIfChanged(context, stored, []);
            return [];
        }
        // Network / timeout / 5xx / 429 / parse / redirect / 404-exhausted: keep last good
        // catalog by letting the host record the error.
        logger.warn(`LiteLLM 发现失败，保留上次结果：${messageOf(error)}`);
        throw error;
    }
}
/** Whether the error is a host-side cancellation (AbortError / "…aborted" reason). */
function isAbortError(error) {
    if (!(error instanceof Error))
        return false;
    return error.name === "AbortError" || /aborted/i.test(error.message);
}
/** Whether the failure came from address normalization (config error, not transport). */
function normalizeLiteLLMURLFailed(error, _baseUrl) {
    if (error instanceof DiscoveryError)
        return false;
    // normalizeLiteLLMURL only rejects non-URL / non-http(s) / credential-bearing strings,
    // always with a message starting with "LiteLLM 地址".
    return messageOf(error).startsWith("LiteLLM 地址");
}
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
/** Best-effort URL display that never includes userinfo (defensive; config may be raw). */
function redactUrl(value) {
    return value.replace(/\/\/[^/@\s]+@/g, "//***@");
}
/**
 * Persist `models` only when the registered list actually changed. Covers the empty-list
 * branches too, so repeated identical empty results do not rewrite models-store (spec:
 * 仅在内容变化时更新).
 */
async function publishIfChanged(context, stored, models) {
    if (modelsFingerprint(stored?.models) === modelsFingerprint(models))
        return;
    await publish(context, models);
}
function asStoredCatalog(stored) {
    if (!stored || !Array.isArray(stored.models))
        return undefined;
    const models = stored.models;
    return { models, checkedAt: 0 };
}
/** Stable fingerprint over the registered model list, for change detection against `stored`. */
function modelsFingerprint(models) {
    if (!models)
        return "";
    return JSON.stringify(models.map((model) => ({
        id: model.id,
        api: model.api,
        baseUrl: model.baseUrl,
        reasoning: model.reasoning,
        thinkingLevelMap: model.thinkingLevelMap,
        input: model.input,
        cost: model.cost,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
    })));
}
/** Persist the given model list into the host catalog; failures must not fail the refresh. */
async function publish(context, models) {
    if (!context.publish)
        return;
    // A cancelled refresh must not write the store: skip before racing the abort.
    if (context.signal?.aborted)
        return;
    try {
        await context.publish({ persist: { models, checkedAt: Date.now() } });
    }
    catch (error) {
        // The host's publish rejects with an abort reason when cancellation lands during the
        // write (supersede / 15s catalog timeout / shutdown) — normal lifecycle, not a
        // persistence failure. Only real store errors (disk, permissions) are worth a warning.
        if (context.signal?.aborted || isAbortError(error))
            return;
        // Persistence failure must not prevent this refresh's result from taking effect.
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`LiteLLM 目录持久化失败（不影响本次结果）：${message}`);
    }
}
