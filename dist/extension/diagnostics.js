import { readFileSync } from "node:fs";
import { getRuntimeIdentity, shortArtifactDigest, shortCoreCommit } from "./runtime-identity.js";
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
    if (snapshot.note)
        lines.push(`说明：${snapshot.note}`);
    lines.push(`Core：${build.coreBranch}@${build.coreSHA}`);
    const identity = getRuntimeIdentity();
    lines.push("Runtime Identity", `Plugin Version   ${identity.pluginVersion}`, `Artifact         ${shortArtifactDigest(identity)}`, `Core Commit      ${shortCoreCommit(identity)}`);
    return lines.join("\n");
}
