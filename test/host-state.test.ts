import { describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  authPath,
  credentialState,
  HostStateError,
  modelsStorePath,
  removeModelsStoreEntry,
  removeStoredCredential,
  saveStoredCredential,
  validateApiKey,
} from "../src/extension/host-state.ts"

const agent = () => mkdtempSync(join(tmpdir(), "pi-hoststate-"))

describe("host-state: host file mode / ACL preservation", () => {
  const posixOnly = process.platform === "win32" // win32 has no POSIX modes

  test.skipIf(posixOnly)("[HOST-PERM] existing auth.json (0660) keeps its mode across Connect / Replace / Disconnect", async () => {
    const dir = agent()
    writeFileSync(authPath(dir), "{}")
    chmodSync(authPath(dir), 0o660)
    await saveStoredCredential(dir, "litellm", "sk-a")
    expect(statSync(authPath(dir)).mode & 0o777).toBe(0o660)
    await saveStoredCredential(dir, "litellm", "sk-b") // replace
    expect(statSync(authPath(dir)).mode & 0o777).toBe(0o660)
    await removeStoredCredential(dir, "litellm") // disconnect
    expect(statSync(authPath(dir)).mode & 0o777).toBe(0o660)
  })

  test.skipIf(posixOnly)("[HOST-PERM] existing models-store.json (0660) keeps its mode after endpoint cleanup", async () => {
    const dir = agent()
    writeFileSync(modelsStorePath(dir), JSON.stringify({ litellm: { models: [1] } }))
    chmodSync(modelsStorePath(dir), 0o660)
    await removeModelsStoreEntry(dir, "litellm")
    expect(statSync(modelsStorePath(dir)).mode & 0o777).toBe(0o660)
  })

  test.skipIf(posixOnly)("[HOST-PERM] files are created with 0600", async () => {
    const dir = agent()
    await saveStoredCredential(dir, "litellm", "sk-a")
    expect(statSync(authPath(dir)).mode & 0o777).toBe(0o600)
  })

  test("[HOST-PERM] a failed write restores the previous bytes (no truncated host file)", async () => {
    const dir = agent()
    writeFileSync(authPath(dir), JSON.stringify({ litellm: { type: "api_key", key: "sk-keep" } }))
    const before = readFileSync(authPath(dir), "utf8")
    await expect(
      saveStoredCredential(dir, "litellm", "sk-new", (path) => {
        writeFileSync(path, "PARTIAL") // simulate a write that truncates and then fails
        throw new Error("ENOSPC")
      }),
    ).rejects.toThrow("ENOSPC")
    expect(readFileSync(authPath(dir), "utf8")).toBe(before)
  })
})

describe("host-state", () => {
  test("[CRED-CONNECT][CRED-LOGIN-CONSISTENT] saved credential uses Pi's api_key shape, per provider id", async () => {
    const dir = agent()
    await saveStoredCredential(dir, "litellm-company", "sk-one")
    expect(JSON.parse(readFileSync(authPath(dir), "utf8"))).toEqual({ "litellm-company": { type: "api_key", key: "sk-one" } })
    expect(credentialState(dir, "litellm-company")).toBe("stored")
    expect(credentialState(dir, "litellm")).toBe("none")
    // A credential written by the host's /login (same shape) is seen identically.
    writeFileSync(authPath(dir), JSON.stringify({ "litellm-company": { type: "api_key", key: "sk-one" }, litellm: { type: "api_key", key: "sk-host" } }))
    expect(credentialState(dir, "litellm")).toBe("stored")
  })

  test("[CRED-REPLACE][CRED-DISCONNECT] replace overwrites; disconnect removes only that provider and keeps unrelated auth entries", async () => {
    const dir = agent()
    writeFileSync(authPath(dir), JSON.stringify({ anthropic: { type: "oauth", access: "a", refresh: "r", expires: 1 }, litellm: { type: "api_key", key: "sk-a" }, "litellm-company": { type: "api_key", key: "sk-b" } }))
    await saveStoredCredential(dir, "litellm-company", "sk-new")
    let auth = JSON.parse(readFileSync(authPath(dir), "utf8"))
    expect(auth["litellm-company"].key).toBe("sk-new")
    expect(auth.litellm.key).toBe("sk-a")
    expect(auth.anthropic.type).toBe("oauth")
    expect(await removeStoredCredential(dir, "litellm-company")).toBe(true)
    auth = JSON.parse(readFileSync(authPath(dir), "utf8"))
    expect(Object.keys(auth)).toEqual(["anthropic", "litellm"])
    expect(await removeStoredCredential(dir, "litellm-company")).toBe(false)
  })

  test("[CRED-CORRUPT-STORE] unparseable auth.json is never overwritten and reports unknown state", async () => {
    const dir = agent()
    writeFileSync(authPath(dir), "{ broken")
    expect(credentialState(dir, "litellm")).toBe("unknown")
    await expect(saveStoredCredential(dir, "litellm", "sk-x")).rejects.toBeInstanceOf(HostStateError)
    await expect(removeStoredCredential(dir, "litellm")).rejects.toBeInstanceOf(HostStateError)
    expect(readFileSync(authPath(dir), "utf8")).toBe("{ broken")
    expect(readdirSync(dir).sort()).toEqual(["auth.json"])
  })

  test.each(["", "   ", "sk a", "sk\nx", "sk\u0000x", "sk\tx"])("[CRED-INVALID-KEY] rejects %p", (raw) => {
    expect(validateApiKey(raw).ok).toBe(false)
  })
  test("[CRED-INVALID-KEY] accepts and trims a normal key", () => {
    expect(validateApiKey("  sk-abc_123  ")).toEqual({ ok: true, key: "sk-abc_123" })
  })

  test("removal never creates missing files", async () => {
    const dir = agent()
    expect(await removeStoredCredential(dir, "litellm")).toBe(false)
    expect(await removeModelsStoreEntry(dir, "litellm")).toBe(false)
    expect(existsSync(authPath(dir))).toBe(false)
    expect(existsSync(modelsStorePath(dir))).toBe(false)
  })

  test("[DEL-CLEANUP][DEL-ISOLATED] models-store removal deletes only the provider entry", async () => {
    const dir = agent()
    writeFileSync(modelsStorePath(dir), JSON.stringify({ litellm: { models: [1] }, "litellm-company": { models: [2] }, other: { models: [3] } }))
    expect(await removeModelsStoreEntry(dir, "litellm-company")).toBe(true)
    expect(JSON.parse(readFileSync(modelsStorePath(dir), "utf8"))).toEqual({ litellm: { models: [1] }, other: { models: [3] } })
  })
})
