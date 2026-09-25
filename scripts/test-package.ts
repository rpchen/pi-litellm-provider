import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = fileURLToPath(new URL("..", import.meta.url))
const npm = process.platform === "win32" ? "npm.cmd" : "npm"

interface Manifest {
  name?: string
  version?: string
  pi?: { extensions?: string[] }
  files?: string[]
}

function fail(message: string): never {
  process.stderr.write(`test:package: ${message}\n`)
  process.exit(1)
}

function normalize(relative: string): string {
  return path.posix.normalize(relative.replace(/^\.\//, ""))
}

const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as Manifest

// Pi loads extension TypeScript directly (jiti, no build step), so the manifest entry must
// resolve inside the repository. A pi Git package is a plain checkout, so nothing is compiled.
const extensions = manifest.pi?.extensions ?? []
if (extensions.length === 0) fail("package.json is missing pi.extensions")
for (const entry of extensions) {
  if (!existsSync(path.join(root, entry))) fail(`pi.extensions entry does not exist: ${entry}`)
}

// The npm tarball must ship the same sources, so an npm-sourced install behaves like a Git install.
const packed = spawnSync(npm, ["pack", "--dry-run", "--json"], {
  cwd: root,
  encoding: "utf8",
  env: process.env,
})
if (packed.status !== 0) {
  process.stderr.write(packed.stdout ?? "")
  process.stderr.write(packed.stderr ?? "")
  fail("npm pack --dry-run failed")
}

const start = (packed.stdout ?? "").indexOf("[")
if (start < 0) fail("npm pack --dry-run did not return JSON")
const report = JSON.parse((packed.stdout ?? "").slice(start)) as Array<{
  files?: Array<{ path: string }>
}>
const shipped = new Set((report[0]?.files ?? []).map((file) => normalize(file.path)))

const required = ["package.json", ...extensions.map(normalize)]
const missing = required.filter((entry) => !shipped.has(entry))
if (missing.length > 0) fail(`npm tarball is missing: ${missing.join(", ")}`)

// ".tmp/" and local agent state must never reach a published tarball.
const leaked = [...shipped].filter(
  (entry) => entry.startsWith(".tmp/") || entry.startsWith("node_modules/"),
)
if (leaked.length > 0) fail(`npm tarball leaked local state: ${leaked.join(", ")}`)

process.stdout.write(
  `test:package: ok (${manifest.name}@${manifest.version}, ${shipped.size} files, pi.extensions=${extensions.join(", ")})\n`,
)
