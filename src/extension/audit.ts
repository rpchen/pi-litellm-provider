/**
 * Pi audit export: the allowlisted provider model list plus the canonical Runtime Identity.
 *
 * Mirrors the OpenCode `model-audit-export` semantics (plugin-submitted view, explicit
 * units, no credential/URL/raw-response leakage) while using Pi's provider model shape.
 * The `baseUrl` of each provider model contains the LiteLLM address and is therefore
 * excluded from the allowlist.
 */
import { getRuntimeIdentity } from "./runtime-identity.ts"
import type { ProviderModelConfigLike } from "./types.ts"
import type { DiscoveryDiagnostics, ModelDiagnostic } from "../core/index.ts"

export interface AuditEndpointInput {
  readonly id: string
  readonly providerId: string
  readonly status: string
  readonly models: readonly ProviderModelConfigLike[]
  readonly discovery?: DiscoveryDiagnostics
  readonly cacheSource?: string
  readonly lkgIDs?: readonly string[]
}

export interface AuditModelRecord {
  readonly id: string
  readonly name: string
  readonly api?: string
  readonly reasoning: boolean
  readonly thinkingLevelMap?: Partial<Record<string, string | null>>
  readonly input: readonly ("text" | "image")[]
  readonly cost: { readonly input: number; readonly output: number; readonly cacheRead: number; readonly cacheWrite: number }
  readonly contextWindow: number
  readonly maxTokens: number
}

function auditModelRecord(model: ProviderModelConfigLike, diagnostic: ModelDiagnostic | undefined, source: string): AuditModelRecord & { metadata?: object } {
  const record: AuditModelRecord = {
    id: model.id,
    name: model.name,
    reasoning: model.reasoning,
    input: [...model.input],
    cost: {
      input: model.cost.input,
      output: model.cost.output,
      cacheRead: model.cost.cacheRead,
      cacheWrite: model.cost.cacheWrite,
    },
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  }
  return {
    ...record,
    ...(model.api !== undefined ? { api: model.api } : {}),
    ...(model.thinkingLevelMap !== undefined ? { thinkingLevelMap: { ...model.thinkingLevelMap } } : {}),
    ...(diagnostic ? { metadata: {
      canonicalID: diagnostic.quality.identity.canonicalModelID,
      provider: diagnostic.quality.metadataSource?.providerID,
      recordKey: diagnostic.quality.metadataSource?.recordID,
      reasoningSupported: model.reasoning ? "supported" : "unsupported",
      reasoningLevels: Object.values(model.thinkingLevelMap ?? {}).filter((value): value is string => typeof value === "string"),
      source,
    } } : {}),
  }
}

export function createAuditReport(
  endpoints: readonly AuditEndpointInput[],
  now = new Date(),
): object {
  const identity = getRuntimeIdentity()
  return {
    schemaVersion: 1,
    scope: "plugin-submitted",
    exportedAt: now.toISOString(),
    units: {
      cost: "USD per million tokens",
    },
    defaults: {
      emptyModels: "没有可用的已注册模型，不代表上游确认不支持任何模型",
    },
    runtimeIdentity: {
      pluginVersion: identity.pluginVersion,
      artifactDigest: identity.artifactDigest,
      coreCommit: identity.coreCommit,
    },
    endpoints: endpoints.map((endpoint) => ({
      id: endpoint.id,
      providerId: endpoint.providerId,
      status: endpoint.status,
      modelCount: endpoint.models.length,
      source: endpoint.cacheSource,
      models: endpoint.models.map((model) => auditModelRecord(model, endpoint.discovery?.models.find((item) => item.id === model.id), endpoint.lkgIDs?.includes(model.id) ? "last-known-good" : "models.dev")),
    })),
  }
}
