/**
 * Host-owned persisted state for an endpoint: credential (auth.json) and discovery catalog
 * (models-store.json). Both are keyed by provider id. See design.md D3/D4.
 */
import { existsSync, readFileSync } from "node:fs"
import { basename, join } from "node:path"
import { atomicWriteFile, withFileLock } from "./fs-lock.ts"

export class HostStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "HostStateError"
  }
}

export type CredentialState = "stored" | "none" | "unknown"

export const authPath = (agentDir: string) => join(agentDir, "auth.json")
export const modelsStorePath = (agentDir: string) => join(agentDir, "models-store.json")

interface JsonFile {
  exists: boolean
  data: Record<string, unknown>
}

function readJsonObject(path: string): JsonFile {
  if (!existsSync(path)) return { exists: false, data: {} }
  const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "")
  if (text.trim().length === 0) return { exists: true, data: {} }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new HostStateError(`${basename(path)} 无法解析，已拒绝修改以免覆盖其中的内容`)
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HostStateError(`${basename(path)} 不是 JSON 对象，已拒绝修改`)
  }
  return { exists: true, data: value as Record<string, unknown> }
}

export function credentialState(agentDir: string, providerId: string): CredentialState {
  try {
    return Object.prototype.hasOwnProperty.call(readJsonObject(authPath(agentDir)).data, providerId) ? "stored" : "none"
  } catch {
    return "unknown"
  }
}

export type ApiKeyCheck = { ok: true; key: string } | { ok: false; message: string }

export function validateApiKey(raw: string): ApiKeyCheck {
  const key = raw.trim()
  if (key.length === 0) return { ok: false, message: "API Key 不能为空" }
  if (/[\s\u0000-\u001f\u007f]/u.test(key)) return { ok: false, message: "API Key 不能包含空白或控制字符" }
  return { ok: true, key }
}

function writeJson(path: string, data: Record<string, unknown>): void {
  atomicWriteFile(path, JSON.stringify(data, null, 2), { mode: 0o600 })
}

/** Connect or replace: same `{type:"api_key",key}` shape Pi's `/login` stores. */
export async function saveStoredCredential(agentDir: string, providerId: string, key: string): Promise<void> {
  const path = authPath(agentDir)
  await withFileLock(path, () => {
    const { data } = readJsonObject(path)
    writeJson(path, { ...data, [providerId]: { type: "api_key", key } })
  })
}

/** Removes only `providerId`; returns whether an entry existed. Missing file is not created. */
export async function removeStoredCredential(agentDir: string, providerId: string): Promise<boolean> {
  return removeKey(authPath(agentDir), providerId)
}

/** Removes the persisted discovery catalog/snapshot for `providerId`. */
export async function removeModelsStoreEntry(agentDir: string, providerId: string): Promise<boolean> {
  return removeKey(modelsStorePath(agentDir), providerId)
}

async function removeKey(path: string, key: string): Promise<boolean> {
  if (!existsSync(path)) return false
  return withFileLock(path, () => {
    const { exists, data } = readJsonObject(path)
    if (!exists || !Object.prototype.hasOwnProperty.call(data, key)) return false
    const { [key]: _removed, ...rest } = data
    writeJson(path, rest)
    return true
  })
}
