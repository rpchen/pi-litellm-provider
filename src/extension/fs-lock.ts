/**
 * File lock + atomic write primitives for state owned by the Pi host.
 *
 * Pi serialises auth.json / models-store.json with `proper-lockfile` (realpath:false): the lock
 * is a `<file>.lock` directory whose mtime is refreshed while held and which is reclaimed once it
 * is older than 30 s. Pi does not expose its storage to extensions and `proper-lockfile` is not our
 * peer dependency, so we implement the same protocol (see design.md D3).
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, rmdirSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { dirname } from "node:path"

export const LOCK_STALE_MS = 30_000

export interface LockOptions {
  staleMs?: number
  timeoutMs?: number
  retryMs?: number
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : undefined
}

export async function withFileLock<T>(file: string, fn: () => Promise<T> | T, options: LockOptions = {}): Promise<T> {
  const lockDir = `${file}.lock`
  const staleMs = options.staleMs ?? LOCK_STALE_MS
  const deadline = Date.now() + (options.timeoutMs ?? 10_000)
  mkdirSync(dirname(file), { recursive: true })
  for (;;) {
    try {
      mkdirSync(lockDir)
      break
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error
      let stale = false
      try {
        stale = Date.now() - statSync(lockDir).mtimeMs > staleMs
      } catch {
        continue // released between mkdir and stat: retry immediately
      }
      if (stale) {
        try { rmdirSync(lockDir) } catch { /* another process reclaimed it */ }
        continue
      }
      if (Date.now() > deadline) throw new Error(`无法获取文件锁（另一个进程正在写入）：${file}`)
      await sleep(options.retryMs ?? 25)
    }
  }
  const refresh = setInterval(() => {
    try {
      const now = new Date()
      utimesSync(lockDir, now, now)
    } catch { /* lock gone: nothing to refresh */ }
  }, Math.max(1, Math.floor(staleMs / 3)))
  refresh.unref?.()
  try {
    return await fn()
  } finally {
    clearInterval(refresh)
    try { rmdirSync(lockDir) } catch { /* already reclaimed */ }
  }
}

export interface AtomicWriteOptions {
  mode?: number
  /** Test seam for simulating an interrupted replace. */
  rename?: (from: string, to: string) => void
}

export interface InPlaceWriteOptions {
  mode?: number
  /** Test seam: simulates a failing write (e.g. ENOSPC after truncation). */
  writeFile?: (path: string, content: string, options: { encoding: BufferEncoding; mode?: number }) => void
}

/**
 * Write a file in place (same inode): Node applies the mode only when creating, so an existing file keeps
 * its mode and ACL exactly like Pi's own FileAuthStorageBackend writes. On failure the previous bytes are
 * restored best-effort so a host-owned file is never left truncated. See design.md D3.
 */
export function writeFileInPlace(path: string, content: string, options: InPlaceWriteOptions = {}): void {
  mkdirSync(dirname(path), { recursive: true })
  const write = options.writeFile ?? writeFileSync
  const previous = existsSync(path) ? readFileSync(path) : undefined
  try {
    write(path, content, { encoding: "utf8", ...(options.mode !== undefined ? { mode: options.mode } : {}) })
  } catch (error) {
    if (previous !== undefined) {
      try { writeFileSync(path, previous) } catch { /* keep the primary error */ }
    }
    throw error
  }
}

/** Write a sibling temp file then rename over `path`; the temp file never outlives a failure. */
export function atomicWriteFile(path: string, content: string, options: AtomicWriteOptions = {}): void {
  mkdirSync(dirname(path), { recursive: true })
  const existingMode = existsSync(path) ? statSync(path).mode & 0o777 : undefined
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`
  try {
    writeFileSync(tmp, content, { encoding: "utf8", mode: options.mode })
    if (existingMode !== undefined) {
      try { chmodSync(tmp, existingMode) } catch { /* best effort on platforms without POSIX modes */ }
    }
    ;(options.rename ?? renameSync)(tmp, path)
  } catch (error) {
    rmSync(tmp, { force: true })
    throw error
  }
}
