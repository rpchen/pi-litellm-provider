import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { prepareCore, PROVENANCE_PATH } from "./prepare-core.ts"

const args = process.argv.slice(2)
if (args.length === 0) {
  process.stderr.write("用法：bun scripts/run-with-core.ts <命令> [参数...]\n")
  process.exit(2)
}

let selection
try {
  selection = prepareCore({
    sha: process.env.LITELLM_CORE_SHA,
    fromProvenance: process.env.LITELLM_CORE_FROM_PROVENANCE === "1" || existsSync(PROVENANCE_PATH),
  })
} catch (error) {
  process.stderr.write(`core 准备失败：${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}

const [requestedCommand, ...commandArgs] = args
const command = requestedCommand === "tsc"
  ? path.join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc")
  : requestedCommand
const result = spawnSync(command!, commandArgs, {
  cwd: process.cwd(),
  env: { ...process.env, LITELLM_CORE_SHA: selection.sha },
  stdio: "inherit",
  shell: process.platform === "win32" && command!.endsWith(".cmd"),
})
if (result.error) {
  process.stderr.write(`命令执行失败：${result.error.message}\n`)
  process.exit(1)
}
process.exit(result.status ?? 1)
