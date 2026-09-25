/**
 * Extension configuration: LiteLLM address resolution and optional tuning knobs.
 *
 * Address sources, highest precedence first:
 *   1. `LITELLM_BASE_URL` environment variable
 *   2. project config `.pi/litellm.json` (relative to the current working directory)
 *   3. global config `~/.pi/agent/litellm.json`
 *
 * The API key is intentionally NOT read here: it flows through pi's own auth chain
 * (`/login` stored credential, then `$LITELLM_API_KEY`), so discovery and model calls
 * always resolve the same key via the host.
 *
 * Fault tolerance mirrors `fgrehm/pi-ollama-cloud`'s sanitizeConfig: unknown keys are
 * dropped, values with wrong types are ignored, and malformed JSON never throws.
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { getAgentDir } from "@earendil-works/pi-coding-agent"

/** LiteLLM protocol override value accepted by the extension configuration. */
export type ConfigProtocol = "chat" | "responses" | "messages"

/** Resolved extension configuration. `baseUrl` is empty when no source provided one. */
export interface ExtensionConfig {
  /** Raw configured address (not normalized); empty string means "not connected". */
  baseUrl: string
  /** Seconds between discovery polls. Default 300, clamped to a 30s minimum. */
  pollInterval: number
  /** Whether to cap context windows at the first pricing tier boundary. Default true. */
  contextTierCap: boolean
  /** Per-model protocol overrides, keyed by LiteLLM `model_name`. */
  protocolOverrides: Record<string, ConfigProtocol>
  /** Global config file path, exposed for diagnostics. */
  globalConfigPath: string
  /** Project config file path, exposed for diagnostics. */
  projectConfigPath: string
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
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Keep only known keys with valid types; drop everything else silently. */
function sanitizeFileConfig(raw: Record<string, unknown>): FileConfig {
  const out: FileConfig = {}

  if (typeof raw.baseUrl === "string" && raw.baseUrl.trim().length > 0) {
    out.baseUrl = raw.baseUrl.trim()
  }

  if (typeof raw.pollInterval === "number" && Number.isFinite(raw.pollInterval) && raw.pollInterval > 0) {
    out.pollInterval = raw.pollInterval
  }

  if (typeof raw.contextTierCap === "boolean") {
    out.contextTierCap = raw.contextTierCap
  }

  if (isRecord(raw.protocolOverrides)) {
    const overrides: Record<string, ConfigProtocol> = {}
    for (const [model, protocol] of Object.entries(raw.protocolOverrides)) {
      if (typeof protocol === "string" && PROTOCOLS.has(protocol as ConfigProtocol)) {
        overrides[model] = protocol as ConfigProtocol
      }
    }
    if (Object.keys(overrides).length > 0) out.protocolOverrides = overrides
  }

  return out
}

/** Read one JSON config file; malformed or non-object content is ignored with a warning. */
function readConfigFile(path: string, logger: ConfigLogger): FileConfig {
  if (!existsSync(path)) return {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"))
    if (!isRecord(parsed)) {
      logger.warn(`LiteLLM 配置 ${path} 不是对象，已忽略`)
      return {}
    }
    return sanitizeFileConfig(parsed)
  } catch (error) {
    logger.warn(`LiteLLM 配置 ${path} 解析失败，已忽略：${error instanceof Error ? error.message : String(error)}`)
    return {}
  }
}

/**
 * Resolve configuration for the given working directory.
 *
 * `env` defaults to `process.env`; `agentDir` defaults to pi's agent directory, both
 * injectable for tests.
 */
export function loadConfig(
  cwd: string,
  logger: ConfigLogger = console,
  env: Record<string, string | undefined> = process.env,
  agentDir: string = getAgentDir(),
): ExtensionConfig {
  const globalConfigPath = join(agentDir, "litellm.json")
  const projectConfigPath = join(cwd, ".pi", "litellm.json")

  const globalFile = readConfigFile(globalConfigPath, logger)
  const projectFile = readConfigFile(projectConfigPath, logger)

  // Address precedence: env > project > global.
  const envBaseUrl = env.LITELLM_BASE_URL?.trim()
  const baseUrl = envBaseUrl && envBaseUrl.length > 0 ? envBaseUrl : (projectFile.baseUrl ?? globalFile.baseUrl ?? "")

  // Tuning precedence mirrors the address sources so a project can override the global
  // defaults; `pollInterval` is clamped to the documented minimum.
  const rawPollInterval = projectFile.pollInterval ?? globalFile.pollInterval ?? DEFAULT_POLL_INTERVAL_SECONDS
  let pollInterval = rawPollInterval
  if (pollInterval < MIN_POLL_INTERVAL_SECONDS) {
    logger.warn(`LiteLLM pollInterval 小于 ${MIN_POLL_INTERVAL_SECONDS} 秒，已钳制`)
    pollInterval = MIN_POLL_INTERVAL_SECONDS
  }

  const contextTierCap = projectFile.contextTierCap ?? globalFile.contextTierCap ?? true
  const protocolOverrides = {
    ...(globalFile.protocolOverrides ?? {}),
    ...(projectFile.protocolOverrides ?? {}),
  }

  return { baseUrl, pollInterval, contextTierCap, protocolOverrides, globalConfigPath, projectConfigPath }
}

/** True when an address was resolved from any source. */
export function isConfigured(config: ExtensionConfig): boolean {
  return config.baseUrl.length > 0
}
