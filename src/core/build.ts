/**
 * Host-independent assembly of LiteLLM deployments + models.dev catalog into ModelSpec[].
 *
 * Copied from ../opencode-litellm-provider/src/core/build.ts with the host leak removed:
 * `ModelSpec.package` (a host SDK package name) is gone — the protocol is the neutral
 * output and src/extension/map.ts maps it to a pi-ai API id. No pi or OpenCode imports
 * allowed in this directory.
 */
import { mapCapabilities, type ModelCapabilities, type ModelCost, type ModelLimits } from "./capabilities.ts"
import { groupLiteLLMDeployments } from "./litellm.ts"
import {
  buildVariants,
  releaseTimestamp,
  selectModelsDevRecord,
  type ModelVariant,
} from "./modelsdev.ts"
import { resolveProtocol, type Protocol } from "./protocol.ts"

export interface BuildOptions {
  contextTierCap: boolean
  protocolOverrides: Readonly<Record<string, Protocol>>
}

export interface ModelSpec {
  id: string
  name: string
  protocol: Protocol
  capabilities: ModelCapabilities
  variants: ModelVariant[]
  released: number
  releaseUnit?: "unix-ms" | "unknown" | "none"
  cost: ModelCost
  limit: ModelLimits
}

export function buildModelSpecs(
  litellmResponse: unknown,
  modelsDevCatalog: unknown,
  options: BuildOptions,
): ModelSpec[] {
  return groupLiteLLMDeployments(litellmResponse)
    .map((group): ModelSpec => {
      const protocol = resolveProtocol(group, options.protocolOverrides)
      const selected = selectModelsDevRecord(group, modelsDevCatalog)
      const mapped = mapCapabilities(group, selected, options.contextTierCap)
      const released = releaseTimestamp(selected)
      const sourceDate = selected?.record.release_date
      return {
        id: group.modelName,
        name: group.modelName,
        protocol,
        capabilities: mapped.capabilities,
        variants: buildVariants(selected, protocol),
        released,
        releaseUnit: typeof sourceDate === "number" && Number.isFinite(sourceDate)
          ? "unknown"
          : typeof sourceDate === "string" && Number.isFinite(Date.parse(sourceDate)) ? "unix-ms" : "none",
        cost: mapped.cost,
        limit: mapped.limit,
      }
    })
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, item]) => [key, stableValue(item)]),
  )
}

export function modelFingerprint(models: readonly ModelSpec[]): string {
  return JSON.stringify(stableValue(models))
}
