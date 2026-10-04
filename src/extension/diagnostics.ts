import { readFileSync } from "node:fs"
import type {
  DiscoveryCacheDiagnostics,
  DiscoveryDiagnostics,
  LastKnownGoodStore,
} from "../core/index.ts"
import { createLastKnownGoodStore } from "../core/index.ts"
import { getRuntimeIdentity, shortArtifactDigest, shortCoreCommit } from "./runtime-identity.ts"
import type { ProviderModelConfigLike } from "./types.ts"

export type ProviderDiagnosticStatus =
  | "idle"
  | "restored"
  | "ready"
  | "stale"
  | "empty"
  | "unconfigured"
  | "inactive"
  | "credential-missing"
  | "auth-error"
  | "config-error"
  | "error"

export interface ProviderDiagnosticSnapshot {
  readonly status: ProviderDiagnosticStatus
  readonly modelCount: number
  readonly discovery?: DiscoveryDiagnostics
  readonly publication?: PublicationSummary
  readonly cache?: DiscoveryCacheDiagnostics
  readonly lastSuccessfulDiscoveryAt?: string
  readonly note?: string
  /** Last registered provider models (allowlisted shape); used by audit export. */
  readonly models?: readonly ProviderModelConfigLike[]
}

export interface PublicationModelState {
  readonly id: string
  readonly status: string
}

export interface PublicationBlockedModel {
  readonly id: string
  readonly status: string
  readonly gaps: readonly string[]
  /** Core eligibility. Adapters must not re-derive this from status strings. */
  readonly degradationEligible: boolean
  readonly degradationReason?: string
}

/** Adapter-visible slice of the Core publication partition (no policy logic). */
export interface PublicationSummary {
  readonly publishable: readonly PublicationModelState[]
  readonly degradedIDs: readonly string[]
  readonly lkgIDs: readonly string[]
  readonly blocked: readonly PublicationBlockedModel[]
  readonly failureKind?: string
}

/** Per-endpoint publication controller: LKG store + degraded acceptance. */
export interface PublicationController {
  readonly store: LastKnownGoodStore
  readonly acceptedDegradedIDs: Set<string>
}

export interface ProviderDiagnosticsState {
  current: ProviderDiagnosticSnapshot
  publication?: PublicationController
}

/** Resolve (creating on first use) the endpoint-scoped publication controller. */
export function publicationControllerForState(
  state: ProviderDiagnosticsState | undefined,
): PublicationController {
  const existing = state?.publication
  if (existing) return existing
  const created: PublicationController = {
    store: createLastKnownGoodStore(),
    acceptedDegradedIDs: new Set<string>(),
  }
  if (state) state.publication = created
  return created
}

export function createProviderDiagnosticsState(): ProviderDiagnosticsState {
  return { current: { status: "idle", modelCount: 0 } }
}

export function setProviderDiagnostics(
  state: ProviderDiagnosticsState | undefined,
  snapshot: ProviderDiagnosticSnapshot,
): void {
  if (state) state.current = snapshot
}

interface PackageManifest {
  version?: unknown
}

interface CoreProvenance {
  sha?: unknown
  branch?: unknown
}

function readJSON<T>(url: URL): T | undefined {
  try {
    return JSON.parse(readFileSync(url, "utf8")) as T
  } catch {
    return undefined
  }
}

export function runtimeBuildInfo(): { pluginVersion: string; coreSHA: string; coreBranch: string } {
  const identity = getRuntimeIdentity()
  if (identity.pluginVersion !== "unknown") {
    const provenance =
      readJSON<CoreProvenance>(new URL("../core-provenance.json", import.meta.url)) ??
      readJSON<CoreProvenance>(new URL("../../dist/core-provenance.json", import.meta.url))
    return {
      pluginVersion: identity.pluginVersion,
      coreSHA: identity.coreCommit,
      coreBranch: typeof provenance?.branch === "string" ? provenance.branch : "unknown",
    }
  }
  const manifest = readJSON<PackageManifest>(new URL("../../package.json", import.meta.url))
  const provenance =
    readJSON<CoreProvenance>(new URL("../core-provenance.json", import.meta.url)) ??
    readJSON<CoreProvenance>(new URL("../../dist/core-provenance.json", import.meta.url))
  return {
    pluginVersion: typeof manifest?.version === "string" ? manifest.version : "unknown",
    coreSHA: typeof provenance?.sha === "string" ? provenance.sha : "unknown",
    coreBranch: typeof provenance?.branch === "string" ? provenance.branch : "unknown",
  }
}

function ageText(ageMs: number | undefined): string {
  if (ageMs === undefined) return "未知"
  if (ageMs < 1_000) return "<1秒"
  if (ageMs < 60_000) return `${Math.floor(ageMs / 1_000)}秒`
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}分钟`
  return `${Math.floor(ageMs / 3_600_000)}小时`
}

function pad2(value: number): string {
  return String(value).padStart(2, "0")
}

/**
 * Format an instant in the timezone configured on the running host.
 *
 * Internal discovery state remains UTC/epoch based. The optional offset is only
 * for deterministic tests; production callers omit it and use the host timezone.
 */
export function formatHostDateTime(
  value: string | number | Date,
  timezoneOffsetMinutes?: number,
): string {
  const instant = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (!Number.isFinite(instant.getTime())) return String(value)

  const offset = timezoneOffsetMinutes ?? instant.getTimezoneOffset()
  const local = new Date(instant.getTime() - offset * 60_000)
  const displayOffset = -offset
  const sign = displayOffset >= 0 ? "+" : "-"
  const absoluteOffset = Math.abs(displayOffset)
  const offsetHours = Math.floor(absoluteOffset / 60)
  const offsetMinutes = absoluteOffset % 60

  return [
    `${local.getUTCFullYear()}-${pad2(local.getUTCMonth() + 1)}-${pad2(local.getUTCDate())}`,
    `${pad2(local.getUTCHours())}:${pad2(local.getUTCMinutes())}:${pad2(local.getUTCSeconds())}`,
    `UTC${sign}${pad2(offsetHours)}:${pad2(offsetMinutes)}`,
  ].join(" ")
}

/** Render the Core publication partition: states, gaps, LKG, degraded. */
export function formatPublicationSummary(summary: PublicationSummary | undefined): string[] {
  if (!summary) return []
  const lines = [
    `模型配置：可用 ${summary.publishable.length} · 未完成 ${summary.blocked.length} · 降级 ${summary.degradedIDs.length} · LKG ${summary.lkgIDs.length}`,
  ]
  if (summary.failureKind) lines.push(`元数据获取失败：${summary.failureKind}（未用默认值伪装完整配置）`)
  if (summary.lkgIDs.length > 0) lines.push(`LKG 提供：${summary.lkgIDs.join("、")}`)
  if (summary.degradedIDs.length > 0) lines.push(`已接受降级：${summary.degradedIDs.join("、")}（仍标记为降级，非完整配置）`)
  for (const blocked of summary.blocked.slice(0, 5)) {
    lines.push(`未完成：${blocked.id} · ${blocked.status}${blocked.gaps.length > 0 ? ` · 缺失 ${blocked.gaps.join("、")}` : ""}`)
  }
  if (summary.blocked.length > 5) lines.push(`……另有 ${summary.blocked.length - 5} 个未完成模型`)
  return lines
}

const STATUS_TEXT: Readonly<Record<ProviderDiagnosticStatus, string>> = {
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
}

export function formatProviderDiagnostics(
  state: ProviderDiagnosticsState,
  now = Date.now(),
  timezoneOffsetMinutes?: number,
): string {
  const snapshot = state.current
  const build = runtimeBuildInfo()
  const lines = [
    `LiteLLM Diagnostics · Pi ${build.pluginVersion}`,
    `状态：${STATUS_TEXT[snapshot.status]}`,
    `已注册模型：${snapshot.modelCount}`,
  ]

  if (snapshot.lastSuccessfulDiscoveryAt) {
    lines.push(`最近成功发现：${formatHostDateTime(snapshot.lastSuccessfulDiscoveryAt, timezoneOffsetMinutes)}`)
  }
  if (snapshot.cache) {
    const cache = snapshot.cache
    const dynamicAge = cache.refreshedAt === undefined
      ? cache.ageMs
      : Math.max(0, now - cache.refreshedAt)
    lines.push(
      `缓存：${cache.source} · stale=${cache.stale ? "是" : "否"} · age=${ageText(dynamicAge)} · failures=${cache.failureCount}`,
    )
    if (cache.nextRetryAt !== undefined) {
      lines.push(`下次允许重试：${formatHostDateTime(cache.nextRetryAt, timezoneOffsetMinutes)}`)
    }
  }

  const discovery = snapshot.discovery
  if (discovery) {
    lines.push(
      `/v1/model/info：${discovery.modelInfo.status} · /v1/models：未作为发现源`,
      `models.dev：${discovery.modelsDev.status} · 命中 ${discovery.stats.modelsDevMatched}/${discovery.stats.models}`,
      `协议 fallback：${discovery.stats.protocolFallbacks} · 过滤条目：${discovery.stats.filteredEntries}`,
    )
    const warningCount = discovery.issues.filter((issue) => issue.severity !== "info").length
    lines.push(`诊断告警：${warningCount}`)
    const examples = discovery.issues
      .filter((issue) => issue.severity !== "info")
      .slice(0, 3)
      .map((issue) => issue.modelId ? `${issue.modelId}: ${issue.code}` : issue.code)
    if (examples.length > 0) lines.push(`重点：${examples.join("；")}`)
  }

  lines.push(...formatPublicationSummary(snapshot.publication))

  if (snapshot.note) lines.push(`说明：${snapshot.note}`)
  lines.push(`Core：${build.coreBranch}@${build.coreSHA}`)
  const identity = getRuntimeIdentity()
  lines.push(
    "Runtime Identity",
    `Plugin Version   ${identity.pluginVersion}`,
    `Artifact         ${shortArtifactDigest(identity)}`,
    `Core Commit      ${shortCoreCommit(identity)}`,
  )
  return lines.join("\n")
}
