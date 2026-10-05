/**
 * Discovery entry point behind pi's `refreshModels`.
 *
 * Implements design D5/D6:
 *  - restore phase (`allowNetwork` false) replays the host-persisted catalog
 *  - network phase performs real discovery and persists the result via `publish`
 *  - failure classification: network/parse/redirect/ratelimit/server/404-exhausted throw
 *    (host keeps the last good catalog); 401/403 and the no-address case return an empty list
 *  - successful results (including empty ones) are persisted so removals survive restarts
 *
 * The API key comes from the host-resolved credential when present, falling back to the
 * host's own `apiKey` reference resolution (which we cannot observe here). A missing key
 * is treated as "not configured": no network request, empty list.
 */
import { buildPublicationResult, catalogFromPublication, classifyMetadataFailure, compareDiscoverySnapshots, createDiscoveryCacheDiagnostics, createDiscoveryCoordinator, createDiscoverySnapshot, capturedPublicationVerdict, createLastKnownGoodEntry, decideAcknowledgement, diagnoseModelSpecs, endpointFingerprint, groupLiteLLMDeployments, inspectDiscoverySnapshot, lastKnownGoodKey, modelFingerprint, normalizeLiteLLMURL, } from "../core/index.js";
import { DiscoveryError, fetchLiteLLMModelInfo, getModelsDevCatalog } from "../net/fetch.js";
import { publicationControllerForState, setProviderDiagnostics, } from "./diagnostics.js";
import { toProviderModels, toProviderModelsWithPublication } from "./map.js";
/** Create one coordinator per registered provider instance. */
export function createProviderRefreshCoordinator() {
    return createDiscoveryCoordinator();
}
/**
 * Run the network phase: contact LiteLLM, enrich from models.dev, build specs and map to
 * pi provider configs. Throws `DiscoveryError` on degradable failures.
 *
 * Publication partition comes from Core `buildPublicationResult`: only
 * `configured` and `configured-lkg` models map to provider configs. A
 * models.dev fetch failure does not abort discovery; it is classified with
 * the Core taxonomy so valid LKG entries can substitute while the rest stay
 * withheld with reasons. One model's failure never gates another's.
 */
export async function discoverModels(config, apiKey, signal, deps = {}) {
    const addresses = normalizeLiteLLMURL(config.baseUrl);
    const litellmResponse = await fetchLiteLLMModelInfo(addresses, apiKey, deps.fetchImpl, signal);
    let catalog;
    let catalogFailure;
    try {
        catalog = deps.loadModelsDevCatalog
            ? await deps.loadModelsDevCatalog(signal)
            : await getModelsDevCatalog({ fetchImpl: deps.fetchImpl, logger: deps.logger, signal });
    }
    catch (error) {
        catalog = {};
        catalogFailure = classifyMetadataFailure(error);
    }
    const buildOptions = {
        contextTierCap: config.contextTierCap,
        protocolOverrides: config.protocolOverrides,
    };
    const now = deps.publication?.now ?? Date.now();
    const publication = buildPublicationResult(litellmResponse, catalog, buildOptions, {
        store: deps.publication?.store,
        failure: catalogFailure,
        now,
    });
    if (deps.publication?.store) {
        seedPublicationLKG(deps.publication.store, litellmResponse, publication, now);
    }
    const diagnosed = diagnoseModelSpecs(litellmResponse, catalog, buildOptions);
    const specs = publication.publishable.map((entry) => entry.spec);
    // Published specs are the only persisted specs: a withheld model never
    // survives into a snapshot, and no user confirmation can add one.
    const snapshotSpecs = [...specs];
    const catalogFacts = catalogFromPublication(publication, {
        discovered: diagnosticsModelCount(diagnosed.diagnostics),
        previouslyPublished: deps.publication?.previouslyPublished,
    });
    return {
        specs,
        snapshotSpecs,
        models: toProviderModelsWithPublication(publication.publishable, addresses.rootURL),
        fingerprint: modelFingerprint(specs),
        diagnostics: diagnosed.diagnostics,
        publication: summarizePublication(publication, catalogFacts, catalogFailure),
        catalog: catalogFacts,
    };
}
/** Discovered model count from the Core diagnostics (never a synthesized value). */
function diagnosticsModelCount(diagnostics) {
    return diagnostics.stats.models;
}
/** Record complete configured models as Last Known Good for future outages. */
function seedPublicationLKG(store, litellmResponse, publication, now) {
    const groups = new Map(groupLiteLLMDeployments(litellmResponse).map((item) => [item.modelName, item]));
    for (const entry of publication.publishable) {
        if (entry.assessment.status !== "configured")
            continue;
        const group = groups.get(entry.spec.id);
        if (!group)
            continue;
        try {
            store.set(lastKnownGoodKey(entry.spec.id), createLastKnownGoodEntry(group, entry.assessment.identity.selected, entry.spec, now, capturedPublicationVerdict(entry.assessment)));
        }
        catch {
            // Seeding is best-effort; it must never fail a discovery.
        }
    }
}
function summarizePublication(publication, catalogFacts, failure) {
    const facts = (id, assessment) => [
        ...assessment.discrepancies.map((item) => ({
            model: id,
            field: item.field,
            status: item.status,
            resolution: item.resolution,
        })),
        ...assessment.conflicts.map((item) => ({
            model: id,
            field: item.field,
            status: item.status,
            resolution: item.resolution,
        })),
    ];
    const allFacts = [
        ...publication.publishable.flatMap((entry) => facts(entry.spec.id, entry.assessment)),
        ...publication.blocked.flatMap((entry) => facts(entry.spec.id, entry.assessment)),
    ];
    const lkgDetail = publication.publishable
        .map((entry) => entry.assessment.lkgDetail)
        .find((detail) => detail !== undefined);
    return {
        discovered: catalogFacts.discovered,
        publishable: publication.publishable.map((entry) => ({
            id: entry.spec.id,
            status: entry.assessment.status,
        })),
        lkgIDs: publication.publishable
            .filter((entry) => entry.assessment.usingLKG)
            .map((entry) => entry.spec.id),
        lkgDetail,
        withheld: catalogFacts.withheld.map((entry) => ({
            id: entry.id,
            status: entry.status,
            reasons: entry.reasons,
            previouslyPublished: entry.previouslyPublished,
            retryable: entry.retryability === "retryable",
        })),
        partial: catalogFacts.partial,
        unusable: catalogFacts.unusable,
        regressions: catalogFacts.regressions.map((entry) => entry.id),
        discrepancies: allFacts.filter((fact) => fact.status === "resolved-discrepancy"),
        conflicts: allFacts.filter((fact) => fact.status === "unresolved-conflict"),
        failureKind: failure?.kind,
        acknowledgement: { notify: false, reason: "unchanged", fingerprint: catalogFacts.fingerprint },
    };
}
/**
 * `refreshModels` callback body.
 *
 * Returns the model list the host should register for this provider. See the module
 * comment for the phase/failure semantics.
 */
export async function refreshProviderModels(config, context, deps = {}, coordinator = createProviderRefreshCoordinator(), diagnosticsState) {
    const logger = deps.logger ?? console;
    const stored = asStoredCatalog(context.stored);
    const apiKey = context.credential?.key;
    const expectedEndpoint = snapshotEndpointFingerprint(config, apiKey);
    const restoreFingerprint = snapshotRestoreScopeFingerprint(config);
    const storedEndpoint = stored?.snapshot && typeof stored.snapshot.endpointFingerprint === "string"
        ? stored.snapshot.endpointFingerprint
        : undefined;
    const restored = expectedEndpoint
        ? inspectDiscoverySnapshot(stored?.snapshot, expectedEndpoint)
        : restoreFingerprint !== undefined &&
            stored?.restoreFingerprint === restoreFingerprint &&
            storedEndpoint !== undefined
            ? inspectDiscoverySnapshot(stored.snapshot, storedEndpoint)
            : { compatible: false, reason: "missing" };
    const restoreCompatibleModels = () => {
        if (!restored.compatible || !restored.snapshot)
            return [];
        try {
            return toProviderModels(restored.snapshot.models, normalizeLiteLLMURL(config.baseUrl).rootURL);
        }
        catch {
            return [];
        }
    };
    // Restore phase, or an aborted request: only replay an endpoint-compatible snapshot.
    if (context.allowNetwork === false || context.signal?.aborted) {
        const models = restoreCompatibleModels();
        setProviderDiagnostics(diagnosticsState, {
            status: models.length > 0 ? "restored" : "idle",
            modelCount: models.length,
            models,
            cache: createDiscoveryCacheDiagnostics({
                source: models.length > 0 ? "snapshot" : "none",
                refreshedAt: restored.snapshot ? Date.parse(restored.snapshot.discoveredAt) : undefined,
            }),
            lastSuccessfulDiscoveryAt: restored.snapshot?.discoveredAt,
            note: models.length > 0 ? "当前结果来自 endpoint-compatible 持久化快照。" : undefined,
        });
        return models;
    }
    // No address resolved. Tell the user how to configure one (spec:
    // 记录说明性提示) and drop the catalog so stale models disappear.
    if (config.baseUrl.length === 0) {
        logger.warn("LiteLLM 未配置地址：请设置 LITELLM_BASE_URL，或在全局 ~/.pi/agent/litellm.json 中填写 baseUrl");
        await publishIfChanged(context, stored, []);
        setProviderDiagnostics(diagnosticsState, {
            status: "unconfigured",
            modelCount: 0,
            models: [],
            cache: createDiscoveryCacheDiagnostics({ source: "none" }),
            note: "请配置 LiteLLM 地址后重新刷新。",
        });
        return [];
    }
    // A definition-level invalid endpoint must never reach the network. The
    // adapter refuses apply with config-invalid before any request is attempted.
    if ((config.validation?.kind ?? "ok") === "invalid") {
        await publishIfChanged(context, stored, []);
        setProviderDiagnostics(diagnosticsState, {
            status: "config-error",
            modelCount: 0,
            models: [],
            cache: createDiscoveryCacheDiagnostics({ source: "none" }),
            note: config.validation && config.validation.kind === "invalid"
                ? `endpoint 配置非法：${config.validation.reason}`
                : "endpoint 配置非法。",
        });
        deps.appliedWriter?.({
            kind: "error",
            category: "config-invalid",
            message: config.validation && config.validation.kind === "invalid" ? config.validation.reason : undefined,
            at: new Date().toISOString(),
        });
        return [];
    }
    if (!apiKey) {
        // The host only reaches the network phase when a credential resolved; treat a missing
        // key defensively as unconfigured rather than sending an unauthenticated request.
        logger.warn("LiteLLM Key 未配置，跳过发现（请使用 /login 或设置 LITELLM_API_KEY）");
        await publishIfChanged(context, stored, []);
        setProviderDiagnostics(diagnosticsState, {
            status: "unconfigured",
            modelCount: 0,
            models: [],
            cache: createDiscoveryCacheDiagnostics({ source: "none" }),
            note: "请使用 /login 或 LITELLM_API_KEY 配置凭据。",
        });
        deps.appliedWriter?.({
            kind: "error",
            category: "credential-missing",
            at: new Date().toISOString(),
        });
        return [];
    }
    const discoveryKey = `${config.endpointId ?? ""}\u0000${config.baseUrl}\u0000${apiKey}`;
    const publicationController = publicationControllerForState(diagnosticsState);
    const discoveryDeps = {
        ...deps,
        publication: deps.publication ?? {
            store: publicationController.store,
            previouslyPublished: publicationController.previouslyPublished,
        },
    };
    try {
        const coordinated = await coordinator.refresh(discoveryKey, () => discoverModels(config, apiKey, context.signal, discoveryDeps), {
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
            return restoreCompatibleModels();
        if (coordinated.source === "stale") {
            logger.warn(`LiteLLM 发现失败，使用 last-known-good：${messageOf(coordinated.error)}`);
        }
        const outcome = coordinated.value;
        const successfulEndpoint = expectedEndpoint ?? endpointFingerprint({
            endpointID: config.endpointId,
            baseUrl: config.baseUrl,
            credentialKey: apiKey,
            buildOptions: {
                contextTierCap: config.contextTierCap,
                protocolOverrides: config.protocolOverrides,
            },
        });
        const snapshot = createDiscoverySnapshot(successfulEndpoint, outcome.snapshotSpecs, new Date(coordinated.refreshedAt).toISOString());
        if (restored.compatible && restored.snapshot) {
            const diff = compareDiscoverySnapshots(restored.snapshot, snapshot);
            if (diff.drift) {
                logger.warn(`LiteLLM 发现漂移：added=${diff.added.length}, removed=${diff.removed.length}, protocol=${diff.protocolChanged.length}, capabilities=${diff.capabilityChanged.length}`);
            }
        }
        await publishIfChanged(context, stored, outcome.models, snapshot, restoreFingerprint);
        // Availability facts: acknowledge only notification, record the published
        // set as the regression baseline, and remember whether to surface this
        // round. None of this can change what Core published.
        const acknowledgement = decideAcknowledgement(publicationController.acknowledgement, outcome.catalog, new Date(coordinated.refreshedAt).toISOString());
        publicationController.acknowledgement = acknowledgement.next;
        publicationController.previouslyPublished = new Set(outcome.models.map((model) => model.id));
        if (acknowledgement.notify && !deps.publication) {
            publicationController.pendingNotice = {
                reason: acknowledgement.reason,
                message: outcome.publication.acknowledgement.reason,
            };
        }
        setProviderDiagnostics(diagnosticsState, {
            status: coordinated.source === "stale"
                ? "stale"
                : outcome.models.length === 0 ? "empty" : "ready",
            modelCount: outcome.models.length,
            models: outcome.models,
            discovery: outcome.diagnostics,
            publication: {
                ...outcome.publication,
                acknowledgement: {
                    notify: acknowledgement.notify,
                    reason: acknowledgement.reason,
                    fingerprint: acknowledgement.next?.fingerprint ?? "sha256:none",
                },
            },
            cache: createDiscoveryCacheDiagnostics({
                source: coordinated.source === "cache"
                    ? "memory-cache"
                    : coordinated.source,
                stale: coordinated.stale,
                refreshedAt: coordinated.refreshedAt,
                failureCount: coordinated.failureCount,
                nextRetryAt: coordinated.nextRetryAt,
            }),
            lastSuccessfulDiscoveryAt: new Date(coordinated.refreshedAt).toISOString(),
            note: coordinated.source === "stale" ? "刷新失败，保留上次成功结果。" : undefined,
        });
        deps.appliedWriter?.({
            kind: "active",
            lastDiscoveryAt: new Date(coordinated.refreshedAt).toISOString(),
            modelCount: outcome.models.length,
        });
        return outcome.models;
    }
    catch (error) {
        // Host cancellation (a newer refresh superseded this one, the model selector's 15s
        // catalog budget expired, or the session is shutting down) aborts in-flight requests.
        // That is normal lifecycle, not a failure: replay the persisted baseline silently;
        // the host discards this refresh's result anyway once the signal is aborted.
        if (context.signal?.aborted) {
            return restoreCompatibleModels();
        }
        if (error instanceof DiscoveryError && error.kind === "auth") {
            logger.error(`LiteLLM 认证失败，已撤下全部模型：${error.message}`);
            await publishIfChanged(context, stored, []);
            setProviderDiagnostics(diagnosticsState, {
                status: "auth-error",
                modelCount: 0,
                models: [],
                cache: createDiscoveryCacheDiagnostics({ source: "none" }),
                note: "LiteLLM 返回 401/403；请检查当前凭据权限。",
            });
            deps.appliedWriter?.({
                kind: "error",
                category: "auth",
                at: new Date().toISOString(),
            });
            return [];
        }
        if (normalizeLiteLLMURLFailed(error, config.baseUrl)) {
            // Configuration error (not a transport failure): the address itself is unusable.
            // Spec: 记录错误、不发起发现请求、不注册模型 — so drop the catalog instead of
            // keeping stale models pointed at a dead address.
            logger.error(`LiteLLM 地址无效（${redactUrl(config.baseUrl)}）：${messageOf(error)}`);
            await publishIfChanged(context, stored, []);
            setProviderDiagnostics(diagnosticsState, {
                status: "config-error",
                modelCount: 0,
                models: [],
                cache: createDiscoveryCacheDiagnostics({ source: "none" }),
                note: "LiteLLM 地址无法规范化；未发起发现请求。",
            });
            deps.appliedWriter?.({
                kind: "error",
                category: "config-invalid",
                message: "address normalization failed",
                at: new Date().toISOString(),
            });
            return [];
        }
        // Network / timeout / 5xx / 429 / parse / redirect / 404-exhausted: keep last good
        // catalog by letting the host record the error. Categorise into the frozen taxonomy
        // so the canonical state can distinguish Enabled · Error from Enabled · Not applied.
        logger.warn(`LiteLLM 发现失败，保留上次结果：${messageOf(error)}`);
        const appliedCategory = (() => {
            if (error instanceof DiscoveryError) {
                if (error.kind === "parse")
                    return "parse";
                return "network";
            }
            return "network";
        })();
        const state = coordinator.state(discoveryKey);
        const retained = restoreCompatibleModels();
        setProviderDiagnostics(diagnosticsState, {
            status: "error",
            modelCount: retained.length,
            models: retained,
            cache: createDiscoveryCacheDiagnostics({
                source: state.hasValue ? "stale" : "none",
                stale: state.hasValue,
                refreshedAt: state.refreshedAt,
                failureCount: state.failureCount,
                nextRetryAt: state.nextRetryAt,
                pending: state.pending,
            }),
            lastSuccessfulDiscoveryAt: state.refreshedAt === undefined
                ? restored.snapshot?.discoveredAt
                : new Date(state.refreshedAt).toISOString(),
            note: "发现失败；详细错误已通过宿主日志记录。",
        });
        deps.appliedWriter?.({
            kind: "error",
            category: appliedCategory,
            at: new Date().toISOString(),
        });
        throw error;
    }
}
/** Whether the error is a host-side cancellation (AbortError / "…aborted" reason). */
function isAbortError(error) {
    if (!(error instanceof Error))
        return false;
    return error.name === "AbortError" || /aborted/i.test(error.message);
}
const PI_RESTORE_SCOPE_CREDENTIAL = "pi-restore-scope-v1";
function snapshotRestoreScopeFingerprint(config) {
    if (config.baseUrl.length === 0)
        return undefined;
    try {
        return endpointFingerprint({
            endpointID: config.endpointId,
            baseUrl: config.baseUrl,
            credentialKey: PI_RESTORE_SCOPE_CREDENTIAL,
            buildOptions: {
                contextTierCap: config.contextTierCap,
                protocolOverrides: config.protocolOverrides,
            },
        });
    }
    catch {
        return undefined;
    }
}
function snapshotEndpointFingerprint(config, apiKey) {
    if (config.baseUrl.length === 0 || !apiKey)
        return undefined;
    try {
        return endpointFingerprint({
            endpointID: config.endpointId,
            baseUrl: config.baseUrl,
            credentialKey: apiKey,
            buildOptions: {
                contextTierCap: config.contextTierCap,
                protocolOverrides: config.protocolOverrides,
            },
        });
    }
    catch {
        return undefined;
    }
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
async function publishIfChanged(context, stored, models, snapshot, restoreFingerprint) {
    const sameModels = modelsFingerprint(stored?.models) === modelsFingerprint(models);
    const sameSnapshot = snapshot === undefined
        ? stored?.snapshot === undefined && stored?.restoreFingerprint === undefined
        : stored?.snapshot?.endpointFingerprint === snapshot.endpointFingerprint &&
            stored.snapshot.modelFingerprint === snapshot.modelFingerprint &&
            stored.restoreFingerprint === restoreFingerprint;
    if (sameModels && sameSnapshot)
        return;
    await publish(context, models, snapshot, restoreFingerprint);
}
function asStoredCatalog(stored) {
    if (!stored || !Array.isArray(stored.models))
        return undefined;
    const models = stored.models;
    const snapshot = "snapshot" in stored ? stored.snapshot : undefined;
    const restoreFingerprint = "restoreFingerprint" in stored && typeof stored.restoreFingerprint === "string"
        ? stored.restoreFingerprint
        : undefined;
    return { models, checkedAt: 0, snapshot, restoreFingerprint };
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
async function publish(context, models, snapshot, restoreFingerprint) {
    if (!context.publish)
        return;
    // A cancelled refresh must not write the store: skip before racing the abort.
    if (context.signal?.aborted)
        return;
    try {
        await context.publish({ persist: { models, checkedAt: Date.now(), snapshot, restoreFingerprint } });
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
