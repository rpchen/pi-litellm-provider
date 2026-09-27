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
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
export const DEFAULT_POLL_INTERVAL_SECONDS = 300;
export const MIN_POLL_INTERVAL_SECONDS = 30;
const PROTOCOLS = new Set(["chat", "responses", "messages"]);
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** True when the value parses as an http(s) URL (spec: 地址必须是 http 或 https). */
function isHttpUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
    }
    catch {
        return false;
    }
}
/**
 * Keep only known keys with valid types. Type-invalid known fields are dropped with a
 * warning (spec: 配置文件字段非法时记录警告); unknown keys are ignored silently.
 */
function sanitizeFileConfig(raw, source, logger) {
    const out = {};
    if ("baseUrl" in raw) {
        const value = raw.baseUrl;
        if (typeof value === "string" && value.trim().length > 0 && isHttpUrl(value.trim())) {
            out.baseUrl = value.trim();
        }
        else {
            // Spec: 非字符串或非 http(s) URI 的 baseUrl → 跳过该来源，记录警告。
            logger.warn(`LiteLLM 配置 ${source} 的 baseUrl 非法（需要非空的 http(s) 地址），已跳过该来源`);
        }
    }
    if ("pollInterval" in raw) {
        const value = raw.pollInterval;
        if (typeof value === "number" && Number.isFinite(value) && value > 0) {
            out.pollInterval = value;
        }
        else {
            logger.warn(`LiteLLM 配置 ${source} 的 pollInterval 非法（需要正数秒），已忽略`);
        }
    }
    if ("contextTierCap" in raw) {
        const value = raw.contextTierCap;
        if (typeof value === "boolean") {
            out.contextTierCap = value;
        }
        else {
            logger.warn(`LiteLLM 配置 ${source} 的 contextTierCap 非法（需要布尔值），已忽略`);
        }
    }
    if ("protocolOverrides" in raw) {
        if (isRecord(raw.protocolOverrides)) {
            const overrides = {};
            for (const [model, protocol] of Object.entries(raw.protocolOverrides)) {
                if (typeof protocol === "string" && PROTOCOLS.has(protocol)) {
                    overrides[model] = protocol;
                }
                else {
                    logger.warn(`LiteLLM 配置 ${source} 的 protocolOverrides.${model} 非法（需要 chat/responses/messages），已忽略`);
                }
            }
            if (Object.keys(overrides).length > 0)
                out.protocolOverrides = overrides;
        }
        else {
            logger.warn(`LiteLLM 配置 ${source} 的 protocolOverrides 非法（需要对象），已忽略`);
        }
    }
    return out;
}
/** Read one JSON config file; malformed or non-object content is ignored with a warning. */
function readConfigFile(path, logger) {
    if (!existsSync(path))
        return {};
    try {
        const parsed = JSON.parse(readFileSync(path, "utf-8"));
        if (!isRecord(parsed)) {
            logger.warn(`LiteLLM 配置 ${path} 不是对象，已忽略`);
            return {};
        }
        return sanitizeFileConfig(parsed, path, logger);
    }
    catch (error) {
        logger.warn(`LiteLLM 配置 ${path} 解析失败，已忽略：${error instanceof Error ? error.message : String(error)}`);
        return {};
    }
}
/**
 * Resolve configuration for the given working directory.
 *
 * `env` defaults to `process.env`; `agentDir` defaults to pi's agent directory, both
 * injectable for tests.
 */
export function loadConfig(cwd, logger = console, env = process.env, agentDir = getAgentDir()) {
    const globalConfigPath = join(agentDir, "litellm.json");
    const projectConfigPath = join(cwd, ".pi", "litellm.json");
    const globalFile = readConfigFile(globalConfigPath, logger);
    const projectFile = readConfigFile(projectConfigPath, logger);
    // Address precedence: env > project > global. Every source must yield a non-empty,
    // valid http(s) address (spec: 非空且合法); invalid sources are skipped with a warning
    // so a bad value never blocks a lower-priority valid one.
    const candidates = [
        { source: "环境变量 LITELLM_BASE_URL", value: env.LITELLM_BASE_URL?.trim() },
        { source: projectConfigPath, value: projectFile.baseUrl },
        { source: globalConfigPath, value: globalFile.baseUrl },
    ];
    let baseUrl = "";
    for (const candidate of candidates) {
        const value = candidate.value;
        if (value === undefined || value.length === 0)
            continue;
        if (isHttpUrl(value)) {
            baseUrl = value;
            break;
        }
        logger.warn(`LiteLLM 地址来源 ${candidate.source} 非法（需要 http(s) 地址），已跳过该来源`);
    }
    // Tuning precedence mirrors the address sources so a project can override the global
    // defaults; `pollInterval` is clamped to the documented minimum.
    const rawPollInterval = projectFile.pollInterval ?? globalFile.pollInterval ?? DEFAULT_POLL_INTERVAL_SECONDS;
    let pollInterval = rawPollInterval;
    if (pollInterval < MIN_POLL_INTERVAL_SECONDS) {
        logger.warn(`LiteLLM pollInterval 小于 ${MIN_POLL_INTERVAL_SECONDS} 秒，已钳制`);
        pollInterval = MIN_POLL_INTERVAL_SECONDS;
    }
    const contextTierCap = projectFile.contextTierCap ?? globalFile.contextTierCap ?? true;
    const protocolOverrides = {
        ...(globalFile.protocolOverrides ?? {}),
        ...(projectFile.protocolOverrides ?? {}),
    };
    return { baseUrl, pollInterval, contextTierCap, protocolOverrides, globalConfigPath, projectConfigPath };
}
/** True when an address was resolved from any source. */
export function isConfigured(config) {
    return config.baseUrl.length > 0;
}
