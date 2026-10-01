import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
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

// Pi keeps the stable TypeScript entry for jiti, but that entry must forward to committed JS.
const extensions = manifest.pi?.extensions ?? []
if (extensions.length === 0) fail("package.json is missing pi.extensions")
for (const entry of extensions) {
  if (!existsSync(path.join(root, entry))) fail(`pi.extensions entry does not exist: ${entry}`)
}

// The npm tarball must ship the compiled artifact, so an npm-sourced install behaves like a Git install.
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

const required = [
  "package.json",
  ...extensions.map(normalize),
  "dist/extension/index.js",
  "dist/extension/runtime-identity.js",
  "dist/extension/audit.js",
  "dist/extension/audit-file.js",
  "dist/core/build.js",
  "dist/core-provenance.json",
  // [PACKAGE-IDENTITY] The tarball identity must be present, valid, and consistent with provenance.
  "dist/runtime-identity.json",
]
const missing = required.filter((entry) => !shipped.has(entry))
if (missing.length > 0) fail(`npm tarball is missing: ${missing.join(", ")}`)

// [PACKAGE-IDENTITY] identity ↔ package version ↔ provenance consistency on the candidate.
{
  const identity = JSON.parse(readFileSync(path.join(root, "dist", "runtime-identity.json"), "utf8")) as {
    pluginVersion?: unknown
    artifactDigest?: unknown
    coreCommit?: unknown
  }
  const provenance = JSON.parse(readFileSync(path.join(root, "dist", "core-provenance.json"), "utf8")) as { sha?: unknown }
  if (identity.pluginVersion !== manifest.version) fail("runtime identity pluginVersion must match package.json")
  if (typeof identity.artifactDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(identity.artifactDigest)) {
    fail("runtime identity artifactDigest must be sha256:<64 hex>")
  }
  if (typeof identity.coreCommit !== "string" || !/^[0-9a-f]{40}$/.test(identity.coreCommit) || identity.coreCommit !== provenance.sha) {
    fail("runtime identity coreCommit must match core provenance")
  }
}

// ".tmp/" and local agent state must never reach a published tarball.
const leaked = [...shipped].filter(
  (entry) => entry.startsWith(".tmp/") || entry.startsWith("node_modules/"),
)
if (leaked.length > 0) fail(`npm tarball leaked local state: ${leaked.join(", ")}`)

const packageTestRoot = path.join(root, ".tmp", "package-install-test")
rmSync(packageTestRoot, { recursive: true, force: true })
mkdirSync(packageTestRoot, { recursive: true })
writeFileSync(path.join(packageTestRoot, "package.json"), JSON.stringify({ private: true, type: "module" }), "utf8")
const packedFile = spawnSync(npm, ["pack", "--json", "--pack-destination", packageTestRoot], {
  cwd: root,
  encoding: "utf8",
  env: process.env,
})
if (packedFile.status !== 0) fail("npm pack for isolated install failed")
const packedStart = (packedFile.stdout ?? "").indexOf("[")
if (packedStart < 0) fail("npm pack for isolated install did not return JSON")
const packedReport = JSON.parse((packedFile.stdout ?? "").slice(packedStart)) as Array<{ filename?: string }>
const tarball = packedReport[0]?.filename
if (!tarball) fail("npm pack did not report a tarball")

const installed = spawnSync(npm, ["install", "--ignore-scripts", "--no-save", "--no-package-lock", "--legacy-peer-deps", path.join(packageTestRoot, tarball)], {
  cwd: packageTestRoot,
  encoding: "utf8",
  env: process.env,
})
if (installed.status !== 0) {
  process.stderr.write(installed.stdout ?? "")
  process.stderr.write(installed.stderr ?? "")
  fail("isolated npm install --ignore-scripts failed")
}

// Stub only the peer modules needed while importing the extension; no host implementation is run here.
for (const packageName of ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent"]) {
  const packageDir = path.join(packageTestRoot, "node_modules", ...packageName.split("/"))
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(path.join(packageDir, "package.json"), JSON.stringify({ name: packageName, version: "0.0.0", type: "module" }), "utf8")
  writeFileSync(
    path.join(packageDir, "index.js"),
    packageName.endsWith("pi-coding-agent") ? "export function getAgentDir() { return process.cwd() }\n" : "export {}\n",
    "utf8",
  )
}

const entry = path.join(packageTestRoot, "node_modules", manifest.name ?? "pi-litellm-provider", "extensions", "index.ts")
const runner = spawnSync(process.execPath, ["-e", `const module = await import(${JSON.stringify(pathToFileURL(entry).href)}); if (typeof module.default !== "function") process.exit(1)`], {
  cwd: packageTestRoot,
  encoding: "utf8",
  env: { ...process.env, LITELLM_BASE_URL: "", LITELLM_API_KEY: "" },
})
if (runner.status !== 0) {
  process.stderr.write(runner.stdout ?? "")
  process.stderr.write(runner.stderr ?? "")
  fail("isolated package entry import failed")
}

process.stdout.write(
  `test:package: ok (${manifest.name}@${manifest.version}, ${shipped.size} files, isolated import ok, pi.extensions=${extensions.join(", ")})\n`,
)
