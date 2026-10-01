import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { CORE_BRANCH, CORE_REPOSITORY, PROVENANCE_PATH, ROOT, readProvenanceSHA } from "./prepare-core.ts"
import { verifyRuntimeIdentity } from "./runtime-identity.ts"

const verificationRoot = path.join(ROOT, ".tmp", "dist-verification")
const committedDist = path.join(verificationRoot, "committed")
const rebuiltDist = path.join(verificationRoot, "rebuilt")

function fail(message: string): never {
  throw new Error(message)
}

try {
  if (!existsSync(PROVENANCE_PATH)) fail(`缺少已提交产物 provenance：${PROVENANCE_PATH}`)
  const provenance = JSON.parse(readFileSync(PROVENANCE_PATH, "utf8")) as {
    repository?: unknown
    branch?: unknown
    sha?: unknown
  }
  if (provenance.repository !== CORE_REPOSITORY || provenance.branch !== CORE_BRANCH) {
    fail("dist provenance 的 core 仓库或分支不符合构建约定")
  }
  const sha = readProvenanceSHA()
  if (!sha) fail("dist provenance 缺少有效的 40 位 core SHA")

  verifyRuntimeIdentity({ root: ROOT, dist: path.join(ROOT, "dist"), selectionSHA: sha })

  rmSync(verificationRoot, { recursive: true, force: true })
  mkdirSync(verificationRoot, { recursive: true })
  cpSync(path.join(ROOT, "dist"), committedDist, { recursive: true })

  // [REPRODUCIBLE-BUILD] Rebuild from the pinned SHA; byte-equality proves determinism.

  const buildScript = path.join(ROOT, "scripts", "build.ts")
  const result = spawnSync(process.execPath, [buildScript, `--sha=${sha}`, `--out-dir=${rebuiltDist}`], {
    cwd: ROOT,
    env: { ...process.env, LITELLM_CORE_SHA: sha },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (result.status !== 0) {
    fail(result.stderr || result.stdout || "按 provenance SHA 重建 dist 失败")
  }

  const diff = spawnSync("git", ["diff", "--no-index", "--exit-code", "--", committedDist, rebuiltDist], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (diff.status === 1) {
    fail(`已提交 dist 与 provenance SHA 重建结果不一致：\n${diff.stdout || diff.stderr || "存在产物差异"}`)
  }
  if (diff.status !== 0) {
    fail(diff.stderr || "比较 dist 产物失败")
  }
  verifyRuntimeIdentity({ root: ROOT, dist: rebuiltDist, selectionSHA: sha })
  process.stdout.write(`verify:dist: committed artifact matches core ${sha}\n`)
} finally {
  rmSync(verificationRoot, { recursive: true, force: true })
}
