import { readFileSync } from "node:fs";
import { createLastKnownGoodStore } from "../core/index.js";
import { getRuntimeIdentity, shortArtifactDigest, shortCoreCommit } from "./runtime-identity.js";
/** Resolve (creating on first use) the endpoint-scoped publication controller. */
export function publicationControllerForState(state) {
    const existing = state?.publication;
    if (existing)
        return existing;
    const created = {
        store: createLastKnownGoodStore(),
        previouslyPublished: new Set(),
    };
    if (state)
        state.publication = created;
    return created;
}
/** Consume a pending catalog notice exactly once. */
export function takePendingNotice(state) {
    const controller = state?.publication;
    if (!controller?.pendingNotice)
        return undefined;
    const notice = controller.pendingNotice;
    controller.pendingNotice = undefined;
    return notice;
}
export function createProviderDiagnosticsState() {
    return { current: { status: "idle", modelCount: 0 } };
}
export function setProviderDiagnostics(state, snapshot) {
    if (state)
        state.current = snapshot;
}
function readJSON(url) {
    try {
        return JSON.parse(readFileSync(url, "utf8"));
    }
    catch {
        return undefined;
    }
}
export function runtimeBuildInfo() {
    const identity = getRuntimeIdentity();
    if (identity.pluginVersion !== "unknown") {
        const provenance = readJSON(new URL("../core-provenance.json", import.meta.url)) ??
            readJSON(new URL("../../dist/core-provenance.json", import.meta.url));
        return {
            pluginVersion: identity.pluginVersion,
            coreSHA: identity.coreCommit,
            coreBranch: typeof provenance?.branch === "string" ? provenance.branch : "unknown",
        };
    }
    const manifest = readJSON(new URL("../../package.json", import.meta.url));
    const provenance = readJSON(new URL("../core-provenance.json", import.meta.url)) ??
        readJSON(new URL("../../dist/core-provenance.json", import.meta.url));
    return {
        pluginVersion: typeof manifest?.version === "string" ? manifest.version : "unknown",
        coreSHA: typeof provenance?.sha === "string" ? provenance.sha : "unknown",
        coreBranch: typeof provenance?.branch === "string" ? provenance.branch : "unknown",
    };
}
function ageText(ageMs) {
    if (ageMs === undefined)
        return "未知";
    if (ageMs < 1_000)
        return "<1秒";
    if (ageMs < 60_000)
        return `${Math.floor(ageMs / 1_000)}秒`;
    if (ageMs < 3_600_000)
        return `${Math.floor(ageMs / 60_000)}分钟`;
    return `${Math.floor(ageMs / 3_600_000)}小时`;
}
function pad2(value) {
    return String(value).padStart(2, "0");
}
/**
 * Format an instant in the timezone configured on the running host.
 *
 * Internal discovery state remains UTC/epoch based. The optional offset is only
 * for deterministic tests; production callers omit it and use the host timezone.
 */
export function formatHostDateTime(value, timezoneOffsetMinutes) {
    const instant = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (!Number.isFinite(instant.getTime()))
        return String(value);
    const offset = timezoneOffsetMinutes ?? instant.getTimezoneOffset();
    const local = new Date(instant.getTime() - offset * 60_000);
    const displayOffset = -offset;
    const sign = displayOffset >= 0 ? "+" : "-";
    const absoluteOffset = Math.abs(displayOffset);
    const offsetHours = Math.floor(absoluteOffset / 60);
    const offsetMinutes = absoluteOffset % 60;
    return [
        `${local.getUTCFullYear()}-${pad2(local.getUTCMonth() + 1)}-${pad2(local.getUTCDate())}`,
        `${pad2(local.getUTCHours())}:${pad2(local.getUTCMinutes())}:${pad2(local.getUTCSeconds())}`,
        `UTC${sign}${pad2(offsetHours)}:${pad2(offsetMinutes)}`,
    ].join(" ");
}
/** Render the Core publication partition: availability, withheld reasons, LKG, evidence facts. */
export function formatPublicationSummary(summary) {
    if (!summary)
        return [];
    const lines = [
        `模型配置：发现 ${summary.discovered} · 可用 ${summary.publishable.length} · withheld ${summary.withheld.length} · LKG ${summary.lkgIDs.length}`,
    ];
    if (summary.unusable) {
        lines.push("catalog 当前不可用：endpoint 连接成功，但本轮没有任何模型达到可信发布标准。", "下一步：稍后刷新（Retry）重新发现，或运行 /litellm-diagnostics <endpoint-id> 查看每个模型的 withheld 原因。插件不会用默认值或确认动作强行发布模型。");
    }
    else if (summary.partial) {
        lines.push(`部分可用：${summary.publishable.length} 个模型正常发布，${summary.withheld.length} 个 withheld（其余模型不受影响，无需确认）。`);
    }
    if (summary.failureKind)
        lines.push(`元数据获取失败：${summary.failureKind}（未用默认值伪装完整配置）`);
    if (summary.regressions.length > 0) {
        lines.push(`此前可用、现已撤下：${summary.regressions.join("、")}（这些模型当前不可安全使用；插件不会自动切换到其他模型）`);
    }
    if (summary.lkgIDs.length > 0) {
        lines.push(`使用已信任的前次完整配置（LKG）：${summary.lkgIDs.join("、")}`);
        if (summary.lkgDetail)
            lines.push(`LKG 说明：${summary.lkgDetail}`);
    }
    for (const model of summary.withheld.slice(0, 5)) {
        const reasons = model.reasons.map((item) => item.code).join("+") || "withheld";
        lines.push(`withheld：${model.id} · ${model.status} · ${reasons}${model.retryable ? " · 可重试" : ""}${model.previouslyPublished ? " · 此前可用" : ""}`);
    }
    if (summary.withheld.length > 5)
        lines.push(`……另有 ${summary.withheld.length - 5} 个 withheld 模型`);
    for (const fact of summary.discrepancies.slice(0, 5)) {
        lines.push(`已裁决差异：${fact.model} · ${fact.field} · ${fact.resolution}`);
    }
    for (const fact of summary.conflicts.slice(0, 5)) {
        lines.push(`未决冲突：${fact.model} · ${fact.field} · ${fact.resolution}`);
    }
    return lines;
}
/**
 * User-facing notice for a materially new or regressed availability problem.
 *
 * A first-time gap on a newly discovered model is intentionally silent
 * (diagnostics only); a regression or an unusable catalog is not.
 */
export function catalogNotice(summary) {
    if (!summary?.acknowledgement.notify)
        return undefined;
    switch (summary.acknowledgement.reason) {
        case "catalog-unusable":
            return {
                level: "warning",
                message: `endpoint 连接成功，发现 ${summary.discovered} 个模型，但当前没有任何模型可以安全发布。${summary.regressions.length > 0 ? `此前可用的模型已被撤下：${summary.regressions.join("、")}。` : ""}可用 /model 重新刷新（Retry），或运行 /litellm-diagnostics 查看每个模型的 withheld 原因。`,
            };
        case "regression":
            return {
                level: "warning",
                message: `此前可用的模型已被撤下：${summary.regressions.join("、")}。它们当前不可安全使用，插件不会自动切换到其他模型；请重新刷新（Retry）或改选其他模型。`,
            };
        case "new-issues":
            return {
                level: "info",
                message: `LiteLLM 可用模型集合发生变化：${summary.withheld.length} 个模型 withheld（此前已知问题之外的新问题）。运行 /litellm-diagnostics 查看原因。`,
            };
        default:
            return undefined;
    }
}
const STATUS_TEXT = {
    idle: "尚未执行发现",
    restored: "已从持久化快照恢复，等待网络确认",
    ready: "正常",
    stale: "网络刷新失败，正在使用 last-known-good",
    empty: "发现成功，但没有可用模型",
    unconfigured: "尚未完成 LiteLLM 配置",
    inactive: "未激活",
    "credential-missing": "缺少 endpoint 凭据",
    "auth-error": "认证失败，模型已清空",
    "config-error": "LiteLLM 地址配置无效",
    error: "发现失败",
};
export function formatProviderDiagnostics(state, now = Date.now(), timezoneOffsetMinutes) {
    const snapshot = state.current;
    const build = runtimeBuildInfo();
    const lines = [
        `LiteLLM Diagnostics · Pi ${build.pluginVersion}`,
        `状态：${STATUS_TEXT[snapshot.status]}`,
        `已注册模型：${snapshot.modelCount}`,
    ];
    if (snapshot.lastSuccessfulDiscoveryAt) {
        lines.push(`最近成功发现：${formatHostDateTime(snapshot.lastSuccessfulDiscoveryAt, timezoneOffsetMinutes)}`);
    }
    if (snapshot.cache) {
        const cache = snapshot.cache;
        const dynamicAge = cache.refreshedAt === undefined
            ? cache.ageMs
            : Math.max(0, now - cache.refreshedAt);
        lines.push(`缓存：${cache.source} · stale=${cache.stale ? "是" : "否"} · age=${ageText(dynamicAge)} · failures=${cache.failureCount}`);
        if (cache.nextRetryAt !== undefined) {
            lines.push(`下次允许重试：${formatHostDateTime(cache.nextRetryAt, timezoneOffsetMinutes)}`);
        }
    }
    const discovery = snapshot.discovery;
    if (discovery) {
        lines.push(`/v1/model/info：${discovery.modelInfo.status} · /v1/models：未作为发现源`, `models.dev：${discovery.modelsDev.status} · 命中 ${discovery.stats.modelsDevMatched}/${discovery.stats.models}`, `协议 fallback：${discovery.stats.protocolFallbacks} · 过滤条目：${discovery.stats.filteredEntries}`);
        const warningCount = discovery.issues.filter((issue) => issue.severity !== "info").length;
        lines.push(`诊断告警：${warningCount}`);
        const examples = discovery.issues
            .filter((issue) => issue.severity !== "info")
            .slice(0, 3)
            .map((issue) => issue.modelId ? `${issue.modelId}: ${issue.code}` : issue.code);
        if (examples.length > 0)
            lines.push(`重点：${examples.join("；")}`);
    }
    lines.push(...formatPublicationSummary(snapshot.publication));
    if (snapshot.note)
        lines.push(`说明：${snapshot.note}`);
    lines.push(`Core：${build.coreBranch}@${build.coreSHA}`);
    const identity = getRuntimeIdentity();
    lines.push("Runtime Identity", `Plugin Version   ${identity.pluginVersion}`, `Artifact         ${shortArtifactDigest(identity)}`, `Core Commit      ${shortCoreCommit(identity)}`);
    return lines.join("\n");
}
