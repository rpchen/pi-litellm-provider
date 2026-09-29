/**
 * Extension configuration.
 *
 * Legacy single-endpoint mode keeps the existing precedence:
 *   LITELLM_BASE_URL > project .pi/litellm.json > global ~/.pi/agent/litellm.json.
 *
 * PR9 explicit multi-endpoint mode is intentionally global-only. It is selected when
 * the global file declares `endpoints`; legacy address/protocol fields are then not
 * combined with it and project/env endpoint settings are ignored.
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { getAgentDir } from "@earendil-works/pi-coding-agent"
import { isEndpointID } from "../core/index.ts"

export type ConfigProtocol = "chat" | "responses" | "messages"
export type ConfigMode = "legacy" | "multi"

export interface EndpointConfig {
  /** Stable user-defined identity. It is not a display name and must never be rewritten. */
  readonly id: string
  readonly baseUrl: string
  readonly protocolOverrides: Record<string, ConfigProtocol>
}

/**
 * Root config plus the optional endpoint identity used by one runtime provider view.
 *
 * `mode` remains optional for structural backwards compatibility with existing tests
 * and downstream helper callers; absence means legacy.
 */
export interface ExtensionConfig {
  baseUrl: string
  pollInterval: number
  contextTierCap: boolean
  protocolOverrides: Record<string, ConfigProtocol>
  globalConfigPath: string
  projectConfigPath: string
  mode?: ConfigMode
  endpoints?: readonly EndpointConfig[]
  /** Set only on an explicit multi-endpoint runtime view. */
  endpointID?: string
  /** Sanitized config issues safe to expose in diagnostics (never contains URL/key). */
  configIssues?: readonly string[]
}

export const DEFAULT_POLL_INTERVAL_SECONDS = 300
export const MIN_POLL_INTERVAL_SECONDS = 30

const PROTOCOLS = new Set<ConfigProtocol>(["chat", "responses", "messages"])

export interface ConfigLogger {
  warn(message: string): void
}

interface FileConfig {
  baseUrl?: string
  pollInterval?: number
  contextTierCap?: boolean
  protocolOverrides?: Record<string, ConfigProtocol>
  endpoints?: EndpointConfig[]
  endpointsDeclared: boolean
  configIssues: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

function sanitizeProtocolOverrides(
  raw: unknown,
  source: string,
  logger: ConfigLogger,
): Record<string, ConfigProtocol> | undefined {
  if (!isRecord(raw)) {
    logger.warn(`LiteLLM 配置 ${source} 的 protocolOverrides 非法（需要对象），已忽略`)
    return undefined
  }
  const overrides: Record<string, ConfigProtocol> = {}
  for (const [model, protocol] of Object.entries(raw)) {
    if (typeof protocol === "string" && PROTOCOLS.has(protocol as ConfigProtocol)) {
      overrides[model] = protocol as ConfigProtocol
    } else {
      logger.warn(
        `LiteLLM 配置 ${source} 的 protocolOverrides.${model} 非法（需要 chat/responses/messages），已忽略`,
      )
    }
  }
  return overrides
}

function sanitizeEndpoint(
  id: string,
  value: unknown,
  source: string,
  logger: ConfigLogger,
): EndpointConfig | undefined {
  if (!isEndpointID(id)) {
    logger.warn(`LiteLLM 配置 ${source} 的 endpoint id "${id}" 非法（需要 [a-z0-9][a-z0-9-_]*），已跳过`)
    return undefined
  }
  if (!isRecord(value)) {
    logger.warn(`LiteLLM 配置 ${source} 的 endpoints.${id} 非法（需要对象），已跳过`)
    return undefined
  }
  const baseUrl = typeof value.baseUrl === "string" ? value.baseUrl.trim() : ""
  if (baseUrl.length === 0 || !isHttpUrl(baseUrl)) {
    logger.warn(`LiteLLM 配置 ${source} 的 endpoints.${id}.baseUrl 非法（需要非空 http(s) 地址），已跳过`)
    return undefined
  }
  const protocolOverrides = "protocolOverrides" in value
    ? (sanitizeProtocolOverrides(value.protocolOverrides, `${source} endpoints.${id}`, logger) ?? {})
    : {}
  return { id, baseUrl, protocolOverrides }
}

function sanitizeFileConfig(
  raw: Record<string, unknown>,
  source: string,
  logger: ConfigLogger,
  allowEndpoints: boolean,
): FileConfig {
  const out: FileConfig = { endpointsDeclared: false, configIssues: [] }

  if ("baseUrl" in raw) {
    const value = raw.baseUrl
    if (typeof value === "string" && value.trim().length > 0 && isHttpUrl(value.trim())) {
      out.baseUrl = value.trim()
    } else {
      logger.warn(`LiteLLM 配置 ${source} 的 baseUrl 非法（需要非空的 http(s) 地址），已跳过该来源`)
    }
  }

  if ("pollInterval" in raw) {
    const value = raw.pollInterval
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      out.pollInterval = value
    } else {
      logger.warn(`LiteLLM 配置 ${source} 的 pollInterval 非法（需要正数秒），已忽略`)
    }
  }

  if ("contextTierCap" in raw) {
    const value = raw.contextTierCap
    if (typeof value === "boolean") {
      out.contextTierCap = value
    } else {
      logger.warn(`LiteLLM 配置 ${source} 的 contextTierCap 非法（需要布尔值），已忽略`)
    }
  }

  if ("protocolOverrides" in raw) {
    const overrides = sanitizeProtocolOverrides(raw.protocolOverrides, source, logger)
    if (overrides) out.protocolOverrides = overrides
  }

  if ("endpoints" in raw) {
    out.endpointsDeclared = true
    if (!allowEndpoints) {
      logger.warn(`LiteLLM 配置 ${source} 的 endpoints 已忽略：多 endpoint 只允许配置在全局 litellm.json`)
    } else if (!isRecord(raw.endpoints)) {
      const issue = "全局 endpoints 配置非法：需要对象"
      logger.warn(`LiteLLM 配置 ${source} 的 endpoints 非法（需要对象）`)
      out.configIssues.push(issue)
      out.endpoints = []
    } else {
      const endpoints: EndpointConfig[] = []
      for (const [id, value] of Object.entries(raw.endpoints)) {
        const endpoint = sanitizeEndpoint(id, value, source, logger)
        if (endpoint) endpoints.push(endpoint)
      }
      out.endpoints = endpoints
    }

    if (allowEndpoints && ("baseUrl" in raw || "protocolOverrides" in raw)) {
      const issue = "显式 endpoints 不能与顶层 baseUrl/protocolOverrides 混用"
      logger.warn(`LiteLLM 配置 ${source} 同时声明 endpoints 与 legacy endpoint 字段；为避免身份混用，显式 endpoints 已禁用`)
      out.configIssues.push(issue)
    }
  }

  return out
}

function readConfigFile(path: string, logger: ConfigLogger, allowEndpoints: boolean): FileConfig {
  if (!existsSync(path)) return { endpointsDeclared: false, configIssues: [] }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"))
    if (!isRecord(parsed)) {
      logger.warn(`LiteLLM 配置 ${path} 不是对象，已忽略`)
      return { endpointsDeclared: false, configIssues: [] }
    }
    return sanitizeFileConfig(parsed, path, logger, allowEndpoints)
  } catch (error) {
    logger.warn(`LiteLLM 配置 ${path} 解析失败，已忽略：${error instanceof Error ? error.message : String(error)}`)
    return { endpointsDeclared: false, configIssues: [] }
  }
}

function clampPollInterval(value: number, logger: ConfigLogger): number {
  if (value >= MIN_POLL_INTERVAL_SECONDS) return value
  logger.warn(`LiteLLM pollInterval 小于 ${MIN_POLL_INTERVAL_SECONDS} 秒，已钳制`)
  return MIN_POLL_INTERVAL_SECONDS
}

export function loadConfig(
  cwd: string,
  logger: ConfigLogger = console,
  env: Record<string, string | undefined> = process.env,
  agentDir: string = getAgentDir(),
): ExtensionConfig {
  const globalConfigPath = join(agentDir, "litellm.json")
  const projectConfigPath = join(cwd, ".pi", "litellm.json")

  const globalFile = readConfigFile(globalConfigPath, logger, true)
  const projectFile = readConfigFile(projectConfigPath, logger, false)

  // Presence of the global endpoints key intentionally locks mode to explicit multi,
  // even when its value is invalid. This fail-closed behavior prevents a typo from
  // silently falling back to a different legacy endpoint or environment variable.
  if (globalFile.endpointsDeclared) {
    const mixed = globalFile.configIssues.some((issue) => issue.includes("不能与顶层"))
    const endpoints = mixed ? [] : (globalFile.endpoints ?? [])
    if (env.LITELLM_BASE_URL?.trim()) {
      logger.warn("显式 endpoints 模式已启用，LITELLM_BASE_URL 不参与 endpoint 解析")
    }
    if (
      projectFile.baseUrl !== undefined ||
      projectFile.protocolOverrides !== undefined ||
      projectFile.pollInterval !== undefined ||
      projectFile.contextTierCap !== undefined ||
      projectFile.endpointsDeclared
    ) {
      logger.warn("显式 endpoints 模式为全局配置；项目级 litellm.json 的 endpoint/tuning 字段已忽略")
    }
    return {
      baseUrl: "",
      pollInterval: clampPollInterval(globalFile.pollInterval ?? DEFAULT_POLL_INTERVAL_SECONDS, logger),
      contextTierCap: globalFile.contextTierCap ?? true,
      protocolOverrides: {},
      globalConfigPath,
      projectConfigPath,
      mode: "multi",
      endpoints,
      configIssues: globalFile.configIssues,
    }
  }

  const candidates: Array<{ source: string; value: string | undefined }> = [
    { source: "环境变量 LITELLM_BASE_URL", value: env.LITELLM_BASE_URL?.trim() },
    { source: projectConfigPath, value: projectFile.baseUrl },
    { source: globalConfigPath, value: globalFile.baseUrl },
  ]
  let baseUrl = ""
  for (const candidate of candidates) {
    const value = candidate.value
    if (value === undefined || value.length === 0) continue
    if (isHttpUrl(value)) {
      baseUrl = value
      break
    }
    logger.warn(`LiteLLM 地址来源 ${candidate.source} 非法（需要 http(s) 地址），已跳过该来源`)
  }

  const pollInterval = clampPollInterval(
    projectFile.pollInterval ?? globalFile.pollInterval ?? DEFAULT_POLL_INTERVAL_SECONDS,
    logger,
  )
  const contextTierCap = projectFile.contextTierCap ?? globalFile.contextTierCap ?? true
  const protocolOverrides = {
    ...(globalFile.protocolOverrides ?? {}),
    ...(projectFile.protocolOverrides ?? {}),
  }

  return {
    baseUrl,
    pollInterval,
    contextTierCap,
    protocolOverrides,
    globalConfigPath,
    projectConfigPath,
    mode: "legacy",
  }
}

export function isExplicitMultiEndpointConfig(config: ExtensionConfig): boolean {
  return config.mode === "multi"
}

/** Configured endpoint identities in deterministic JSON/object insertion order. */
export function configuredEndpoints(config: ExtensionConfig): EndpointConfig[] {
  if (isExplicitMultiEndpointConfig(config)) return [...(config.endpoints ?? [])]
  return [{ id: "default", baseUrl: config.baseUrl, protocolOverrides: config.protocolOverrides }]
}

/** Build the per-provider discovery view while preserving global tuning. */
export function endpointRuntimeConfig(config: ExtensionConfig, endpoint: EndpointConfig): ExtensionConfig {
  const explicit = isExplicitMultiEndpointConfig(config)
  return {
    baseUrl: endpoint.baseUrl,
    pollInterval: config.pollInterval,
    contextTierCap: config.contextTierCap,
    protocolOverrides: endpoint.protocolOverrides,
    globalConfigPath: config.globalConfigPath,
    projectConfigPath: config.projectConfigPath,
    mode: explicit ? "multi" : "legacy",
    endpointID: explicit ? endpoint.id : undefined,
    configIssues: config.configIssues,
  }
}

export function isConfigured(config: ExtensionConfig): boolean {
  if (isExplicitMultiEndpointConfig(config)) return (config.endpoints?.length ?? 0) > 0
  return config.baseUrl.length > 0
}
