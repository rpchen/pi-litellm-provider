/**
 * Runtime Identity build helpers (Pi).
 *
 * Canonical digest rule (identical to the OpenCode plugin):
 * - inputs: every regular file under `dist/`, recursively, POSIX relative paths
 *   sorted lexicographically, excluding `runtime-identity.json` itself;
 * - per file: SHA-256 hex of raw bytes;
 * - manifest: `<file-hex>  <relative-path>\n` lines joined as UTF-8;
 * - `artifactDigest = sha256:<SHA-256 hex of the manifest>`.
 * No timestamps, absolute paths, usernames, checkout directories or Git state.
 */
import { createHash } from "node:crypto"
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { ROOT } from "./prepare-core.ts"

export const RUNTIME_IDENTITY_FILE = "runtime-identity.json"

export interface RuntimeIdentityFile {
  pluginVersion: string
  artifactDigest: string
  coreCommit: string
}

function toPosix(value: string): string {
  return value.replaceAll("\\", "/")
}

export function listDigestInputs(dist: string): string[] {
  const inputs: string[] = []
  const walk = (absolute: string, prefix = ""): void => {
    if (!existsSync(absolute) || !lstatSync(absolute).isDirectory() || lstatSync(absolute).isSymbolicLink()) {
      throw new Error("Distribution directory is missing or unsafe")
    }
    for (const name of readdirSync(absolute).sort()) {
      const relative = prefix ? `${prefix}/${name}` : name
      const entry = path.join(absolute, name)
      const stat = lstatSync(entry)
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
        throw new Error(`Non-regular distribution entry: ${relative}`)
      }
      if (stat.isDirectory()) walk(entry, relative)
      else if (toPosix(relative) !== RUNTIME_IDENTITY_FILE) inputs.push(toPosix(relative))
    }
  }
  walk(dist)
  return inputs.sort()
}

export function computeArtifactDigest(dist: string): string {
  const manifest = listDigestInputs(dist)
    .map((relative) => {
      const bytes = readFileSync(path.join(dist, ...relative.split("/")))
      return `${createHash("sha256").update(bytes).digest("hex")}  ${relative}\n`
    })
    .join("")
  return `sha256:${createHash("sha256").update(manifest, "utf8").digest("hex")}`
}

export function readPackageVersion(root: string = ROOT): string {
  let value: unknown
  try {
    value = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
  } catch {
    throw new Error("Runtime identity requires a readable package.json version")
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Runtime identity requires a non-empty package.json version")
  }
  const version = (value as { version?: unknown }).version
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("Runtime identity requires a non-empty package.json version")
  }
  return version
}

export function writeRuntimeIdentity(out: string, input: { pluginVersion: string; coreCommit: string }): RuntimeIdentityFile {
  if (typeof input.pluginVersion !== "string" || input.pluginVersion.length === 0) {
    throw new Error("Runtime identity pluginVersion is missing")
  }
  if (typeof input.coreCommit !== "string" || !/^[0-9a-f]{40}$/u.test(input.coreCommit)) {
    throw new Error("Runtime identity coreCommit must be a complete 40-character hexadecimal commit ID")
  }
  const artifactDigest = computeArtifactDigest(out)
  const identity: RuntimeIdentityFile = { pluginVersion: input.pluginVersion, artifactDigest, coreCommit: input.coreCommit }
  writeFileSync(path.join(out, RUNTIME_IDENTITY_FILE), `${JSON.stringify(identity, null, 2)}\n`, "utf8")
  return identity
}

export function readRuntimeIdentity(dist: string): RuntimeIdentityFile {
  let value: unknown
  try {
    const file = path.join(dist, RUNTIME_IDENTITY_FILE)
    if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw new Error("Unsafe identity")
    value = JSON.parse(readFileSync(file, "utf8"))
  } catch {
    throw new Error("Missing or unreadable runtime identity; rebuild dist to generate it")
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid runtime identity fields")
  }
  const record = value as Record<string, unknown>
  if (typeof record.pluginVersion !== "string" || record.pluginVersion.length === 0
    || typeof record.artifactDigest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(record.artifactDigest)
    || typeof record.coreCommit !== "string" || !/^[0-9a-f]{40}$/u.test(record.coreCommit)) {
    throw new Error("Invalid runtime identity fields")
  }
  return record as unknown as RuntimeIdentityFile
}

/** Formal verification: identity ↔ package version ↔ provenance SHA ↔ dist bytes. [VERIFY-STRICT] */
export function verifyRuntimeIdentity(input: { root?: string; dist: string; selectionSHA: string }): RuntimeIdentityFile {
  const root = input.root ?? ROOT
  const identity = readRuntimeIdentity(input.dist)
  const expectedVersion = readPackageVersion(root)
  if (identity.pluginVersion !== expectedVersion) {
    throw new Error("Runtime identity pluginVersion does not match package.json")
  }
  if (identity.coreCommit !== input.selectionSHA) {
    throw new Error("Runtime identity coreCommit does not match core provenance")
  }
  const expectedDigest = computeArtifactDigest(input.dist)
  if (identity.artifactDigest !== expectedDigest) {
    throw new Error("Runtime identity artifactDigest does not match distribution bytes")
  }
  return identity
}
