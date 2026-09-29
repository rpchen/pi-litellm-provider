import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { isEndpointID } from "../core/index.ts"
import type { ExtensionConfig } from "./config.ts"
import { configuredEndpoints, isExplicitMultiEndpointConfig } from "./config.ts"

export type ActivationMode = "all" | "selected"

export interface ActivationState {
  readonly version: 1
  readonly mode: ActivationMode
  readonly selected: readonly string[]
}

export interface ActivationStore {
  read(): ActivationState
  write(state: ActivationState): void
}

export const DEFAULT_ACTIVATION_STATE: ActivationState = {
  version: 1,
  mode: "all",
  selected: [],
}

function sanitizeActivationState(value: unknown): ActivationState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return DEFAULT_ACTIVATION_STATE
  const record = value as Record<string, unknown>
  if (record.version !== 1 || (record.mode !== "all" && record.mode !== "selected")) return DEFAULT_ACTIVATION_STATE
  const selected = Array.isArray(record.selected)
    ? [...new Set(record.selected.filter(isEndpointID))]
    : []
  return { version: 1, mode: record.mode, selected }
}

export function activationStatePath(globalConfigPath: string): string {
  return join(dirname(globalConfigPath), "litellm-activation.json")
}

export function createActivationStore(globalConfigPath: string): ActivationStore {
  const path = activationStatePath(globalConfigPath)
  return {
    read() {
      if (!existsSync(path)) return DEFAULT_ACTIVATION_STATE
      try {
        return sanitizeActivationState(JSON.parse(readFileSync(path, "utf8")))
      } catch {
        return DEFAULT_ACTIVATION_STATE
      }
    },
    write(state) {
      const normalized = sanitizeActivationState(state)
      mkdirSync(dirname(path), { recursive: true })
      const temporary = `${path}.tmp-${process.pid}`
      try {
        writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
        renameSync(temporary, path)
      } finally {
        rmSync(temporary, { force: true })
      }
    },
  }
}

export function activeEndpointIDs(config: ExtensionConfig, state: ActivationState): string[] {
  const endpoints = configuredEndpoints(config)
  if (!isExplicitMultiEndpointConfig(config)) return endpoints.map((endpoint) => endpoint.id)
  if (state.mode === "all") return endpoints.map((endpoint) => endpoint.id)
  const selected = new Set(state.selected)
  return endpoints.filter((endpoint) => selected.has(endpoint.id)).map((endpoint) => endpoint.id)
}

export function activationForSelection(
  configuredIDs: readonly string[],
  selectedIDs: ReadonlySet<string>,
  preferAll: boolean,
): ActivationState {
  if (preferAll && configuredIDs.every((id) => selectedIDs.has(id))) return DEFAULT_ACTIVATION_STATE
  return {
    version: 1,
    mode: "selected",
    selected: configuredIDs.filter((id) => selectedIDs.has(id)),
  }
}
