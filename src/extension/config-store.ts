/**
 * Non-destructive mutation of the canonical global endpoint configuration (`litellm.json`).
 *
 * Only the target endpoint's keys are touched; unknown fields, global settings and unrelated endpoints
 * are kept. The file is strict JSON (it is read with `JSON.parse`), so a file that does not parse is
 * refused rather than rewritten. See design.md D2/D6.
 */
import { existsSync, readFileSync } from "node:fs"
import { isEndpointID, normalizeLiteLLMURL } from "../core/index.ts"
import { atomicWriteFile, withFileLock } from "./fs-lock.ts"

export type ConfigErrorCode =
  | "parse"
  | "shape"
  | "duplicate"
  | "invalid-id"
  | "invalid-url"
  | "not-found"
  | "conflict"
  | "env-managed"
  | "legacy-conflict"

export class ConfigStoreError extends Error {
  constructor(readonly code: ConfigErrorCode, message: string) {
    super(message)
    this.name = "ConfigStoreError"
  }
}

export type ConfigMutation =
  | { kind: "add"; id: string; baseUrl: string }
  | { kind: "edit"; id: string; baseUrl: string }
  | { kind: "delete"; id: string }

export interface MutationOutcome {
  /** Legacy top-level baseUrl/protocolOverrides were moved into `endpoints.default`. */
  migratedLegacy: boolean
  /** The migrated legacy address came from LITELLM_BASE_URL. */
  fromEnvironment: boolean
}

export interface MutateOptions {
  env?: Record<string, string | undefined>
  rename?: (from: string, to: string) => void
  /** Test seam: runs after the mutation is computed and before the conflict check. */
  beforeCommit?: () => void
}

type Raw = Record<string, unknown>
const isRecord = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value)

export function validateEndpointId(id: string): string | undefined {
  return isEndpointID(id) ? undefined : "Endpoint ID 必须匹配 [a-z0-9][a-z0-9-_]*"
}

export type UrlCheck = { ok: true; value: string } | { ok: false; message: string }

export function validateBaseUrl(raw: string): UrlCheck {
  const value = raw.trim()
  if (value.length === 0) return { ok: false, message: "Base URL 不能为空" }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return { ok: false, message: "Base URL 必须是合法的 http(s) 地址" }
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, message: "Base URL 必须使用 http:// 或 https://" }
  try {
    normalizeLiteLLMURL(value)
  } catch {
    return { ok: false, message: "Base URL 不能包含用户名/密码等凭据信息" }
  }
  return { ok: true, value }
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false
  try {
    const url = new URL(value.trim())
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

interface RawFile {
  text: string
  data: Raw
}

function readRaw(path: string): RawFile {
  if (!existsSync(path)) return { text: "", data: {} }
  const text = readFileSync(path, "utf8")
  const body = text.replace(/^\uFEFF/, "")
  if (body.trim().length === 0) return { text, data: {} }
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch (error) {
    throw new ConfigStoreError("parse", `litellm.json 无法解析为 JSON，已拒绝修改：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isRecord(value)) throw new ConfigStoreError("shape", "litellm.json 不是 JSON 对象，已拒绝修改")
  return { text, data: value }
}

/** Effective legacy default address: LITELLM_BASE_URL overrides the file, exactly like the loader. */
function legacyAddress(raw: Raw, env: Record<string, string | undefined>): { url: string; fromEnv: boolean } {
  const envUrl = env.LITELLM_BASE_URL?.trim()
  if (envUrl && isHttpUrl(envUrl)) return { url: envUrl, fromEnv: true }
  if (isHttpUrl(raw.baseUrl)) return { url: raw.baseUrl.trim(), fromEnv: false }
  return { url: "", fromEnv: false }
}

export interface ConfigInspection {
  mode: "explicit" | "legacy"
  /** Every id present in the file (including entries the loader would skip), so duplicates are caught. */
  ids: string[]
}

export function inspectConfig(path: string, env: Record<string, string | undefined> = process.env): ConfigInspection {
  const { data } = readRaw(path)
  if ("endpoints" in data) {
    if (!isRecord(data.endpoints)) throw new ConfigStoreError("shape", "endpoints 必须是对象，已拒绝修改")
    return { mode: "explicit", ids: Object.keys(data.endpoints) }
  }
  return { mode: "legacy", ids: legacyAddress(data, env).url ? ["default"] : [] }
}

function without(raw: Raw, ...keys: string[]): Raw {
  return Object.fromEntries(Object.entries(raw).filter(([key]) => !keys.includes(key)))
}

export function applyMutation(
  raw: Raw,
  mutation: ConfigMutation,
  env: Record<string, string | undefined> = process.env,
): { next: Raw; outcome: MutationOutcome } {
  if ("endpoints" in raw) {
    if (!isRecord(raw.endpoints)) throw new ConfigStoreError("shape", "endpoints 必须是对象，已拒绝修改")
    if ("baseUrl" in raw || "protocolOverrides" in raw) {
      throw new ConfigStoreError("legacy-conflict", "litellm.json 同时包含 legacy 顶层 baseUrl/protocolOverrides 与 endpoints，已拒绝修改；请先手工修正")
    }
    const endpoints = { ...raw.endpoints }
    const current = endpoints[mutation.id]
    if (mutation.kind === "add") {
      if (mutation.id in endpoints) throw new ConfigStoreError("duplicate", `Endpoint ID ${mutation.id} 已存在`)
      endpoints[mutation.id] = { baseUrl: mutation.baseUrl }
    } else if (mutation.kind === "edit") {
      if (!isRecord(current)) throw new ConfigStoreError("not-found", `Endpoint ${mutation.id} 不存在或不是对象`)
      endpoints[mutation.id] = { ...current, baseUrl: mutation.baseUrl }
    } else {
      if (!(mutation.id in endpoints)) throw new ConfigStoreError("not-found", `Endpoint ${mutation.id} 不存在`)
      delete endpoints[mutation.id]
    }
    return { next: { ...raw, endpoints }, outcome: { migratedLegacy: false, fromEnvironment: false } }
  }

  const legacy = legacyAddress(raw, env)
  if (mutation.kind === "add") {
    const migrated: Raw = {}
    if (legacy.url) {
      migrated.default = {
        baseUrl: legacy.url,
        ...(raw.protocolOverrides !== undefined ? { protocolOverrides: raw.protocolOverrides } : {}),
      }
    } else if (raw.protocolOverrides !== undefined && mutation.id !== "default") {
      throw new ConfigStoreError("legacy-conflict", "litellm.json 含有没有 baseUrl 的顶层 protocolOverrides，无法安全迁移；请先手工修正")
    }
    if (mutation.id in migrated) throw new ConfigStoreError("duplicate", `Endpoint ID ${mutation.id} 已存在`)
    migrated[mutation.id] = {
      baseUrl: mutation.baseUrl,
      ...(!legacy.url && mutation.id === "default" && raw.protocolOverrides !== undefined
        ? { protocolOverrides: raw.protocolOverrides }
        : {}),
    }
    return {
      next: { ...without(raw, "baseUrl", "protocolOverrides"), endpoints: migrated },
      outcome: { migratedLegacy: Boolean(legacy.url), fromEnvironment: legacy.fromEnv },
    }
  }

  if (mutation.id !== "default" || !legacy.url) throw new ConfigStoreError("not-found", `Endpoint ${mutation.id} 不存在`)
  if (legacy.fromEnv) {
    throw new ConfigStoreError("env-managed", "默认 endpoint 的地址来自环境变量 LITELLM_BASE_URL；请修改环境变量，或先把配置迁移为 endpoints 形式")
  }
  const none: MutationOutcome = { migratedLegacy: false, fromEnvironment: false }
  if (mutation.kind === "edit") return { next: { ...raw, baseUrl: mutation.baseUrl }, outcome: none }
  return { next: without(raw, "baseUrl", "protocolOverrides"), outcome: none }
}

function detectIndent(text: string): string | number {
  const match = /^[ \t]+(?=")/m.exec(text)
  if (!match) return 2
  return match[0].startsWith("\t") ? "\t" : match[0].length
}

function validateMutation(mutation: ConfigMutation): void {
  if (mutation.kind === "add") {
    const message = validateEndpointId(mutation.id)
    if (message) throw new ConfigStoreError("invalid-id", message)
  }
  if (mutation.kind !== "delete") {
    const check = validateBaseUrl(mutation.baseUrl)
    if (!check.ok) throw new ConfigStoreError("invalid-url", check.message)
  }
}

export async function mutateConfig(
  path: string,
  mutation: ConfigMutation,
  options: MutateOptions = {},
): Promise<MutationOutcome> {
  validateMutation(mutation)
  const normalized: ConfigMutation = mutation.kind === "delete"
    ? mutation
    : { ...mutation, baseUrl: mutation.baseUrl.trim() }
  return withFileLock(path, () => {
    const first = readRaw(path)
    const { next, outcome } = applyMutation(first.data, normalized, options.env ?? process.env)
    const serialized = JSON.stringify(next, null, detectIndent(first.text)) + "\n"
    options.beforeCommit?.()
    const latest = existsSync(path) ? readFileSync(path, "utf8") : ""
    if (latest !== first.text) {
      throw new ConfigStoreError("conflict", "litellm.json 在读取后被外部修改，已中止写入以免覆盖；请重试")
    }
    atomicWriteFile(path, serialized, { rename: options.rename })
    return outcome
  })
}
