import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { getAgentDir } from "@earendil-works/pi-coding-agent"
import { atomicWriteFile } from "./fs-lock.ts"

export type EndpointActivation =
  | { readonly mode: "all" }
  | { readonly mode: "selected"; readonly endpointIds: readonly string[] }

export interface ActivationLogger { warn(message: string): void }

export function activationPath(agentDir: string = getAgentDir()): string {
  return join(agentDir, "litellm.activation.json")
}

export function loadActivation(
  path: string = activationPath(),
  logger: ActivationLogger = console,
): EndpointActivation {
  if (!existsSync(path)) return { mode: "all" }
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"))
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("需要对象")
    const input = value as Record<string, unknown>
    if (input.mode === "all") return { mode: "all" }
    if (input.mode === "selected" && Array.isArray(input.endpointIds) && input.endpointIds.every((id) => typeof id === "string")) {
      return { mode: "selected", endpointIds: [...new Set(input.endpointIds as string[])] }
    }
    throw new Error("需要 mode=all 或 mode=selected + endpointIds")
  } catch (error) {
    logger.warn(`LiteLLM activation 配置 ${path} 非法，已回退为全部启用：${error instanceof Error ? error.message : String(error)}`)
    return { mode: "all" }
  }
}

export function saveActivation(
  value: EndpointActivation,
  path: string = activationPath(),
): void {
  atomicWriteFile(path, JSON.stringify(value, null, 2) + "\n")
}

export function activeEndpointIds(
  endpointIds: readonly string[],
  activation: EndpointActivation,
): string[] {
  if (activation.mode === "all") return [...endpointIds]
  const selected = new Set(activation.endpointIds)
  return endpointIds.filter((id) => selected.has(id))
}

export function toggleEndpoint(
  endpointIds: readonly string[],
  activation: EndpointActivation,
  endpointId: string,
): EndpointActivation {
  const selected = new Set(
    activation.mode === "all"
      ? endpointIds
      : activation.endpointIds,
  )
  if (selected.has(endpointId)) selected.delete(endpointId)
  else selected.add(endpointId)
  return { mode: "selected", endpointIds: [...selected] }
}
