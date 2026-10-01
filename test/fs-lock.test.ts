import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { atomicWriteFile, withFileLock } from "../src/extension/fs-lock.ts"

const dir = () => mkdtempSync(join(tmpdir(), "pi-fslock-"))

describe("fs-lock", () => {
  test("[CFG-LOCK] stale lock directory left by a dead process is reclaimed", async () => {
    const d = dir()
    const file = join(d, "auth.json")
    mkdirSync(`${file}.lock`)
    const old = new Date(Date.now() - 120_000)
    utimesSync(`${file}.lock`, old, old)
    const result = await withFileLock(file, () => "ran", { timeoutMs: 500 })
    expect(result).toBe("ran")
    expect(existsSync(`${file}.lock`)).toBe(false)
  })

  test("[CFG-LOCK] fresh lock held by another writer is respected until timeout", async () => {
    const d = dir()
    const file = join(d, "auth.json")
    mkdirSync(`${file}.lock`)
    await expect(withFileLock(file, () => "never", { timeoutMs: 120, retryMs: 10 })).rejects.toThrow("文件锁")
    expect(existsSync(`${file}.lock`)).toBe(true) // not stolen
  })

  test("[CFG-LOCK] lock is released after success and after failure; concurrent writers serialise", async () => {
    const d = dir()
    const file = join(d, "x.json")
    await expect(withFileLock(file, () => { throw new Error("boom") })).rejects.toThrow("boom")
    expect(existsSync(`${file}.lock`)).toBe(false)
    let active = 0
    let overlap = false
    await Promise.all([1, 2, 3, 4].map(() => withFileLock(file, async () => {
      active++
      if (active > 1) overlap = true
      await new Promise((r) => setTimeout(r, 15))
      active--
    }, { retryMs: 5 })))
    expect(overlap).toBe(false)
  })

  test("[EDIT-ATOMIC] failed replace keeps the original and leaves no temp file", () => {
    const d = dir()
    const file = join(d, "litellm.json")
    writeFileSync(file, "ORIGINAL")
    expect(() => atomicWriteFile(file, "NEW", { rename: () => { throw new Error("EXDEV") } })).toThrow("EXDEV")
    expect(readFileSync(file, "utf8")).toBe("ORIGINAL")
    expect(readdirSync(d)).toEqual(["litellm.json"])
  })
})
