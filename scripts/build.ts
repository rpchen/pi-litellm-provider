import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { CORE_BRANCH, CORE_REPOSITORY, ROOT, prepareCore } from "./prepare-core.ts"

const dist = path.join(ROOT, "dist")
rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })
const selection = prepareCore({ update: true })
const tsc = process.platform === "win32"
  ? path.join(ROOT, "node_modules", ".bin", "tsc.cmd")
  : path.join(ROOT, "node_modules", ".bin", "tsc")
const result = spawnSync(tsc, ["-p", path.join(ROOT, "tsconfig.build.json")], {
  cwd: ROOT,
  env: { ...process.env, LITELLM_CORE_SHA: selection.sha },
  stdio: "inherit",
})
if (result.status !== 0) process.exit(result.status ?? 1)
writeFileSync(
  path.join(dist, "core-provenance.json"),
  JSON.stringify({ repository: CORE_REPOSITORY, branch: CORE_BRANCH, sha: selection.sha }, null, 2) + "\n",
  "utf8",
)
process.stdout.write(`build:dist: core ${selection.sha}\n`)
