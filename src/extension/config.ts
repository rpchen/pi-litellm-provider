/**
 * Global LiteLLM endpoint configuration.
 *
 * PR9 intentionally has no project-level endpoint configuration. The global
 * ~/.pi/agent/litellm.json file supports either:
 *
 *  - legacy single-endpoint fields (zero-migration, exposed as endpoint "default"), or
 *  - an explicit `endpoints` object keyed by stable user-defined endpoint ids.
 *
 * `LITELLM_BASE_URL` is legacy/default-only. Explicit multi-endpoint mode never
 * synthesizes per-endpoint environment variables.
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { getAgentDir } from "@earendil-works/pi-coding-agent"
import { isEndpointID, normalizeLiteLLMURL } from "../core/index.ts"
import type { ValidationState } from "./endpoint-state.ts"

export type ConfigProtocol = "chat" | "responses" | "messages"

export interface ExtensionConfig {
  /** Present only for explicit multi-endpoint mode; legacy single-endpoint keeps this undefined. */
  endpointId?: string
  baseUrl: string
  pollInterval: number
  contextTierCap: boolean
  protocolOverrides: Record<string, ConfigProtocol>
  globalConfigPath: string
  /** Kept for discovery/test compatibility; PR9 no longer reads project config. */
  projectConfigPath: string
/**
   * Endpoint definition validation. `invalid` means the user's definition is
   * malformed (bad URL/userinfo/etc.); runtime apply refuses the endpoint and
   * the canonical state translates it into Enabled/Disabled · Invalid configuration.
   * A missing credential is NOT a validation failure.
   * When absent (legacy test fixtures), the effective value is `{ kind: "ok" }`.
   */
  validation?: ValidationState
}

export interface EndpointRegistryConfig {
  readonly mode: "legacy" | "explicit"
  readonly endpoints: Readonly<Record<string, ExtensionConfig>>
  readonly globalConfigPath: string
}

export const DEFAULT_POLL_INTERVAL_SECONDS = 300
export const MIN_POLL_INTERVAL_SECONDS = 30
export const DEFAULT_ENDPOINT_ID = "default"

const PROTOCOLS = new Set<ConfigProtocol>(["chat", "responses", "messages"])

export interface ConfigLogger {
  warn(message: string): void
}

interface EndpointFileConfig {
  baseUrl?: string
  protocolOverrides?: Record<string, ConfigProtocol>
  /** Raw invalid baseUrl (the loader previously dropped these entries entirely). */
  invalidBaseUrl?: string
}

interface GlobalFileConfig extends EndpointFileConfig {
  pollInterval?: number
  contextTierCap?: boolean
  endpoints?: Record<string, EndpointFileConfig>
  explicitInvalid?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function isEndpointId(value: string): boolean {
  return isEndpointID(value)
}

function isHttpUrl(value: string): boolean {
  // Use the same entry rule as the runtime. normalizeLiteLLMURL rejects non-http(s)
  // AND userinfo-bearing URLs, keeping manager validation identical to runtime apply.
  try {
    normalizeLiteLLMURL(value)
    return true
  } catch {
    return false
  }
}

function readProtocolOverrides(
  value: unknown,
  source: string,
  logger: ConfigLogger,
): Record<string, ConfigProtocol> | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) {
    logger.warn(`LiteLLM 配置 ${source} 的 protocolOverrides 非法（需要对象），已忽略`)
    return undefined
  }
  const overrides: Record<string, ConfigProtocol> = {}
  for (const [model, protocol] of Object.entries(value)) {
    if (typeof protocol === "string" && PROTOCOLS.has(protocol as ConfigProtocol)) {
      overrides[model] = protocol as ConfigProtocol
    } else {
      logger.warn(`LiteLLM 配置 ${source} 的 protocolOverrides.${model} 非法（需要 chat/responses/messages），已忽略`)
    }
  }
  return overrides
}

function readEndpointConfig(
  raw: Record<string, unknown>,
  source: string,
  logger: ConfigLogger,
): EndpointFileConfig {
  const out: EndpointFileConfig = {}
  if ("baseUrl" in raw) {
    const value = raw.baseUrl
    if (typeof value === "string" && value.trim().length > 0 && isHttpUrl(value.trim())) {
      out.baseUrl = value.trim()
    } else {
      // Preserve the raw value so the endpoint remains visible as Invalid configuration
      // rather than silently disappearing from management and diagnostics.
      if (typeof value === "string") out.invalidBaseUrl = value
      logger.warn(`LiteLLM 配置 ${source} 的 baseUrl 非法（需要非空的 http(s) 地址），endpoint 将被标记为配置非法`)
    }
  }
  const protocolOverrides = readProtocolOverrides(raw.protocolOverrides, source, logger)
  if (protocolOverrides) out.protocolOverrides = protocolOverrides
  return out
}

function readGlobalFile(path: string, logger: ConfigLogger): GlobalFileConfig {
  if (!existsSync(path)) return {}
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"))
  } catch (error) {
    logger.warn(`LiteLLM 配置 ${path} 解析失败，已忽略：${error instanceof Error ? error.message : String(error)}`)
    return {}
  }
  if (!isRecord(raw)) {
    logger.warn(`LiteLLM 配置 ${path} 不是对象，已忽略`)
    return {}
  }

  const out: GlobalFileConfig = readEndpointConfig(raw, path, logger)

  if ("pollInterval" in raw) {
    const value = raw.pollInterval
    if (typeof value === "number" && Number.isFinite(value) && value > 0) out.pollInterval = value
    else logger.warn(`LiteLLM 配置 ${path} 的 pollInterval 非法（需要正数秒），已忽略`)
  }
  if ("contextTierCap" in raw) {
    if (typeof raw.contextTierCap === "boolean") out.contextTierCap = raw.contextTierCap
    else logger.warn(`LiteLLM 配置 ${path} 的 contextTierCap 非法（需要布尔值），已忽略`)
  }

  if ("endpoints" in raw) {
    if (!isRecord(raw.endpoints)) {
      logger.warn(`LiteLLM 配置 ${path} 的 endpoints 非法（需要对象），显式 endpoint 配置已拒绝`)
      out.explicitInvalid = true
      return out
    }
    if ("baseUrl" in raw || "protocolOverrides" in raw) {
      logger.warn("LiteLLM 配置不能同时使用 legacy 单 endpoint 字段与 endpoints；已拒绝该配置")
      out.explicitInvalid = true
      return out
    }
    const endpoints: Record<string, EndpointFileConfig> = {}
    for (const [id, value] of Object.entries(raw.endpoints)) {
      if (!isEndpointId(id)) {
        logger.warn(`LiteLLM endpoint id ${JSON.stringify(id)} 非法（必须匹配 [a-z0-9][a-z0-9-_]*），已跳过`)
        continue
      }
      if (!isRecord(value)) {
        logger.warn(`LiteLLM endpoint ${id} 配置必须是对象，已跳过`)
        continue
      }
      const endpoint = readEndpointConfig(value, `${path} endpoints.${id}`, logger)
      // Endpoints whose baseUrl fails validation are KEPT (marked invalid) so the
      // management UI and diagnostics can show them as "Invalid configuration"
      // instead of the endpoint silently disappearing. Only entries with neither
      // a valid nor an invalid baseUrl (e.g. missing the field entirely) are skipped.
      if (!endpoint.baseUrl && endpoint.invalidBaseUrl === undefined) {
        logger.warn(`LiteLLM endpoint ${id} 缺少合法 baseUrl，已跳过`)
        continue
      }
      endpoints[id] = endpoint
    }
    out.endpoints = endpoints
  }
  return out
}

function normalizePollInterval(value: number | undefined, logger: ConfigLogger): number {
  const interval = value ?? DEFAULT_POLL_INTERVAL_SECONDS
  if (interval < MIN_POLL_INTERVAL_SECONDS) {
    logger.warn(`LiteLLM pollInterval 小于 ${MIN_POLL_INTERVAL_SECONDS} 秒，已钳制`)
    return MIN_POLL_INTERVAL_SECONDS
  }
  return interval
}

function endpointSnapshot(
  endpoint: EndpointFileConfig,
  global: GlobalFileConfig,
  globalConfigPath: string,
  logger: ConfigLogger,
  endpointId?: string,
): ExtensionConfig {
  // Validation is computed here so the runtime, management UI and diagnostics all
  // share one source of truth. The runtime refuses to apply invalid endpoints.
  let validation: ValidationState = { kind: "ok" }
  if (endpoint.invalidBaseUrl !== undefined) {
    validation = { kind: "invalid", reason: "Base URL 非法（需要非空的 http(s) 地址，且不能包含用户名/密码）" }
  }
  return {
    endpointId,
    baseUrl: endpoint.baseUrl ?? "",
    pollInterval: normalizePollInterval(global.pollInterval, logger),
    contextTierCap: global.contextTierCap ?? true,
    protocolOverrides: endpoint.protocolOverrides ?? {},
    globalConfigPath,
    projectConfigPath: "",
    validation,
  }
}

export function loadEndpointRegistry(
  _cwd: string,
  logger: ConfigLogger = console,
  env: Record<string, string | undefined> = process.env,
  agentDir: string = getAgentDir(),
): EndpointRegistryConfig {
  const globalConfigPath = join(agentDir, "litellm.json")
  const global = readGlobalFile(globalConfigPath, logger)

  if (global.endpoints !== undefined || global.explicitInvalid) {
    if (env.LITELLM_BASE_URL?.trim()) {
      logger.warn("显式 endpoints 模式不会读取 LITELLM_BASE_URL；请在 endpoints.default.baseUrl 中配置默认 endpoint")
    }
    if (global.explicitInvalid) return { mode: "explicit", endpoints: {}, globalConfigPath }
    const endpoints = Object.fromEntries(
      Object.entries(global.endpoints ?? {}).map(([id, endpoint]) => [
        id,
        endpointSnapshot(endpoint, global, globalConfigPath, logger, id),
      ]),
    )
    return { mode: "explicit", endpoints, globalConfigPath }
  }

  let baseUrl = global.baseUrl ?? ""
  const envUrl = env.LITELLM_BASE_URL?.trim()
  if (envUrl) {
    if (isHttpUrl(envUrl)) baseUrl = envUrl
    else logger.warn("LiteLLM 地址来源环境变量 LITELLM_BASE_URL 非法（需要 http(s) 地址），已跳过")
  }

  return {
    mode: "legacy",
    endpoints: {
      [DEFAULT_ENDPOINT_ID]: endpointSnapshot(
        { baseUrl, protocolOverrides: global.protocolOverrides },
        global,
        globalConfigPath,
        logger,
      ),
    },
    globalConfigPath,
  }
}

/** Legacy helper retained for discovery-level callers/tests. */
export function loadConfig(
  cwd: string,
  logger: ConfigLogger = console,
  env: Record<string, string | undefined> = process.env,
  agentDir: string = getAgentDir(),
): ExtensionConfig {
  const registry = loadEndpointRegistry(cwd, logger, env, agentDir)
  return registry.endpoints[DEFAULT_ENDPOINT_ID] ?? {
    baseUrl: "",
    pollInterval: DEFAULT_POLL_INTERVAL_SECONDS,
    contextTierCap: true,
    protocolOverrides: {},
    globalConfigPath: registry.globalConfigPath,
    projectConfigPath: "",
    validation: { kind: "ok" },
  }
}

export function isConfigured(config: ExtensionConfig): boolean {
  return config.baseUrl.length > 0 && (config.validation?.kind ?? "ok") === "ok"
}
