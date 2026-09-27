import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const CORE_REPOSITORY = "https://github.com/rpchen/litellm-discovery-core.git"
export const CORE_BRANCH = "main"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(scriptDir, "..")
export const CACHE_ROOT = path.join(ROOT, ".tmp", "discovery-core")
export const GENERATED_CORE_DIR = path.join(ROOT, "src", "core")
export const PROVENANCE_PATH = path.join(ROOT, "dist", "core-provenance.json")

export interface CoreSelection {
  repository: string
  branch: string
  sha: string
  cachePath: string
  generatedPath: string
  source: "main" | "sha" | "provenance" | "cached"
}

function runGit(args: string[], cwd?: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim()
}

function isSHA(value: string): boolean {
  return /^[0-9a-f]{40}$/i.test(value)
}

export function readProvenanceSHA(): string | undefined {
  if (!existsSync(PROVENANCE_PATH)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(PROVENANCE_PATH, "utf8")) as { sha?: unknown }
    return typeof parsed.sha === "string" && isSHA(parsed.sha) ? parsed.sha.toLowerCase() : undefined
  } catch {
    return undefined
  }
}

export function assertCleanCheckout(cachePath: string): void {
  const status = runGit(["status", "--porcelain", "--untracked-files=all"], cachePath)
  if (status) {
    throw new Error(`core 缓存工作区不干净，拒绝使用：${cachePath}`)
  }
}

function resolveMainSHA(): string {
  const output = runGit(["ls-remote", CORE_REPOSITORY, `refs/heads/${CORE_BRANCH}`])
  const sha = output.split(/\s+/u)[0]
  if (!sha || !isSHA(sha)) throw new Error("无法解析 litellm-discovery-core/main 的 commit SHA")
  return sha.toLowerCase()
}

function ensureCheckout(sha: string): string {
  mkdirSync(CACHE_ROOT, { recursive: true })
  const cachePath = path.join(CACHE_ROOT, sha)
  if (!existsSync(path.join(cachePath, ".git"))) {
    if (existsSync(cachePath)) rmSync(cachePath, { recursive: true, force: true })
    runGit(["clone", "--quiet", CORE_REPOSITORY, cachePath])
  }

  const actual = runGit(["rev-parse", "HEAD"], cachePath).toLowerCase()
  if (actual !== sha) {
    runGit(["fetch", "--quiet", "--depth", "1", "origin", sha], cachePath)
    runGit(["checkout", "--quiet", "--detach", sha], cachePath)
  }
  const verified = runGit(["rev-parse", "HEAD"], cachePath).toLowerCase()
  if (verified !== sha) throw new Error(`core checkout SHA 校验失败：期望 ${sha}，实际 ${verified}`)
  assertCleanCheckout(cachePath)
  if (!existsSync(path.join(cachePath, "src", "core"))) {
    throw new Error(`core checkout 缺少 src/core：${sha}`)
  }
  return cachePath
}

function copyGeneratedCore(cachePath: string): void {
  const source = path.join(cachePath, "src", "core")
  rmSync(GENERATED_CORE_DIR, { recursive: true, force: true })
  mkdirSync(path.dirname(GENERATED_CORE_DIR), { recursive: true })
  cpSync(source, GENERATED_CORE_DIR, { recursive: true })
  const indexPath = path.join(GENERATED_CORE_DIR, "index.ts")
  cpSync(path.join(cachePath, "src", "index.ts"), indexPath)
  const indexSource = readFileSync(indexPath, "utf8")
    .replaceAll('"./core/', '"./')
    .replaceAll('.js"', '.ts"')
  writeFileSync(indexPath, indexSource, "utf8")
  writeFileSync(
    path.join(GENERATED_CORE_DIR, ".generated-by-prepare-core"),
    "此目录由 scripts/prepare-core.ts 生成，禁止手工编辑。\n",
    "utf8",
  )
}

export function prepareCore(options: { update?: boolean; sha?: string; fromProvenance?: boolean } = {}): CoreSelection {
  const provenanceSHA = options.fromProvenance ? readProvenanceSHA() : undefined
  const requested = options.sha ?? process.env.LITELLM_CORE_SHA
  const cachedSelection = existsSync(path.join(CACHE_ROOT, "selected.json"))
    ? (() => {
        try {
          const value = JSON.parse(readFileSync(path.join(CACHE_ROOT, "selected.json"), "utf8")) as { sha?: unknown }
          return typeof value.sha === "string" && isSHA(value.sha) ? value.sha.toLowerCase() : undefined
        } catch {
          return undefined
        }
      })()
    : undefined
  const source: CoreSelection["source"] = requested
      ? "sha"
      : provenanceSHA
        ? "provenance"
      : options.update || !cachedSelection
        ? "main"
        : "cached"
  const sha = requested ?? provenanceSHA ?? (source === "main" ? resolveMainSHA() : cachedSelection!)
  const cachePath = ensureCheckout(sha)
  copyGeneratedCore(cachePath)
  const selection: CoreSelection = {
    repository: CORE_REPOSITORY,
    branch: CORE_BRANCH,
    sha,
    cachePath,
    generatedPath: GENERATED_CORE_DIR,
    source,
  }
  mkdirSync(CACHE_ROOT, { recursive: true })
  writeFileSync(path.join(CACHE_ROOT, "selected.json"), JSON.stringify(selection, null, 2) + "\n", "utf8")
  return selection
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = new Set(process.argv.slice(2))
  try {
    const selection = prepareCore({
      update: args.has("--update"),
      sha: process.argv.find((arg) => arg.startsWith("--sha="))?.slice("--sha=".length),
      fromProvenance: args.has("--from-provenance"),
    })
    process.stdout.write(JSON.stringify(selection) + "\n")
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}
