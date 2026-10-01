import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { CORE_BRANCH, CORE_REPOSITORY, ROOT, prepareCore } from "./prepare-core.ts"
import { readPackageVersion, writeRuntimeIdentity } from "./runtime-identity.ts"

const sha = process.argv.find((arg) => arg.startsWith("--sha="))?.slice("--sha=".length)
const outputArg = process.argv.find((arg) => arg.startsWith("--out-dir="))?.slice("--out-dir=".length)
const dist = outputArg ? path.resolve(ROOT, outputArg) : path.join(ROOT, "dist")
rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })
const selection = prepareCore({ update: !sha, sha })
const tsc = process.platform === "win32"
  ? path.join(ROOT, "node_modules", ".bin", "tsc.cmd")
  : path.join(ROOT, "node_modules", ".bin", "tsc")
const result = spawnSync(tsc, ["-p", path.join(ROOT, "tsconfig.build.json"), "--outDir", dist], {
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
writeRuntimeIdentity(dist, { pluginVersion: readPackageVersion(ROOT), coreCommit: selection.sha })
process.stdout.write(`build:dist: core ${selection.sha}\n`)
