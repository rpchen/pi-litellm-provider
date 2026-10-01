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

export interface AuditEndpointInput {
  readonly id: string
  readonly providerId: string
  readonly status: string
  readonly models: readonly ProviderModelConfigLike[]
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

function auditModelRecord(model: ProviderModelConfigLike): AuditModelRecord {
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
  return model.api !== undefined || model.thinkingLevelMap !== undefined
    ? { ...record, ...(model.api !== undefined ? { api: model.api } : {}), ...(model.thinkingLevelMap !== undefined ? { thinkingLevelMap: { ...model.thinkingLevelMap } } : {}) }
    : record
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
      models: endpoint.models.map(auditModelRecord),
    })),
  }
}
