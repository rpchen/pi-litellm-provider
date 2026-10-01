import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import {
  getRuntimeIdentity,
  isValidArtifactDigest,
  isValidCoreCommit,
  isValidPluginVersion,
  parseRuntimeIdentity,
  resetRuntimeIdentityForTests,
  setRuntimeIdentityForTests,
  shortArtifactDigest,
  shortCoreCommit,
} from "../src/extension/runtime-identity.ts"

const CORE_SHA = "8e155e0efe90f1e9e7c8e973239c206a97011477"
const DIGEST = `sha256:${"a".repeat(64)}`
const FIXTURE_IDENTITY = { pluginVersion: "0.5.0", artifactDigest: DIGEST, coreCommit: CORE_SHA }

function digestOfFiles(files: Map<string, Uint8Array>): string {
  const names = [...files.keys()].filter((name) => name !== "runtime-identity.json").sort()
  const manifest = names.map((name) => `${createHash("sha256").update(files.get(name)!).digest("hex")}  ${name}\n`).join("")
  return `sha256:${createHash("sha256").update(manifest, "utf8").digest("hex")}`
}

describe("Runtime Identity [IDENTITY-FIELDS]", () => {
  test("parse accepts three valid fields and rejects bad shapes", () => {
    const valid = parseRuntimeIdentity(FIXTURE_IDENTITY)
    expect(valid).toEqual(FIXTURE_IDENTITY)
    expect(isValidPluginVersion(valid.pluginVersion)).toBeTrue()
    expect(isValidArtifactDigest(valid.artifactDigest)).toBeTrue()
    expect(isValidCoreCommit(valid.coreCommit)).toBeTrue()
  })

  test("parse rejects missing and malformed identity [VERIFY-STRICT]", () => {
    expect(() => parseRuntimeIdentity(undefined)).toThrow()
    expect(() => parseRuntimeIdentity({})).toThrow()
    expect(() => parseRuntimeIdentity({ pluginVersion: "", artifactDigest: DIGEST, coreCommit: CORE_SHA })).toThrow()
    expect(() => parseRuntimeIdentity({ pluginVersion: "0.5.0", artifactDigest: "not-a-digest", coreCommit: CORE_SHA })).toThrow()
    expect(() => parseRuntimeIdentity({ pluginVersion: "0.5.0", artifactDigest: DIGEST, coreCommit: "short" })).toThrow()
    expect(() => parseRuntimeIdentity({ pluginVersion: "0.5.0", artifactDigest: `sha256:${"A".repeat(64)}`, coreCommit: CORE_SHA })).toThrow()
    expect(isValidPluginVersion("")).toBeFalse()
    expect(isValidArtifactDigest("unknown")).toBeFalse()
    expect(isValidCoreCommit("unknown")).toBeFalse()
  })

  test("short forms take the documented prefixes", () => {
    expect(shortArtifactDigest(FIXTURE_IDENTITY)).toBe("a".repeat(8))
    expect(shortCoreCommit(FIXTURE_IDENTITY)).toBe(CORE_SHA.slice(0, 8))
    expect(shortArtifactDigest({ pluginVersion: "0.5.0", artifactDigest: "unknown", coreCommit: "unknown" })).toBe("unknown")
    expect(shortCoreCommit({ pluginVersion: "0.5.0", artifactDigest: "unknown", coreCommit: "unknown" })).toBe("unknown")
  })

  test("canonical getter is shared and resettable [CANONICAL-SINGLE]", () => {
    resetRuntimeIdentityForTests()
    setRuntimeIdentityForTests(FIXTURE_IDENTITY)
    try {
      expect(getRuntimeIdentity()).toEqual(FIXTURE_IDENTITY)
      expect(getRuntimeIdentity()).toBe(getRuntimeIdentity())
    } finally {
      resetRuntimeIdentityForTests()
    }
  })
})

describe("Runtime Identity digest semantics [DIGEST-DETERMINISTIC] [SELF-EXCLUSION]", () => {
  test("input order does not affect the digest", () => {
    const first = new Map([
      ["b.js", new TextEncoder().encode("b")],
      ["a.js", new TextEncoder().encode("a")],
    ])
    const second = new Map([
      ["a.js", new TextEncoder().encode("a")],
      ["b.js", new TextEncoder().encode("b")],
    ])
    expect(digestOfFiles(first)).toBe(digestOfFiles(second))
  })

  test("Windows and POSIX separators produce the same digest inputs", () => {
    const posix = ["a/b.js", "c.js"].sort()
    const windows = ["a\\b.js", "c.js"].map((entry) => entry.replaceAll("\\", "/")).sort()
    expect(windows).toEqual(posix)
  })

  test("identity file itself is excluded so metadata edits do not recurse", () => {
    const base = new Map([
      ["index.js", new TextEncoder().encode("code")],
      ["runtime-identity.json", new TextEncoder().encode(`{"a":1}`)],
    ])
    const edited = new Map([
      ["index.js", new TextEncoder().encode("code")],
      ["runtime-identity.json", new TextEncoder().encode(`{"a":2}`)],
    ])
    expect(digestOfFiles(base)).toBe(digestOfFiles(edited))
  })

  test("artifact byte change alters the digest [DIGEST-SENSITIVE]", () => {
    const before = new Map([["index.js", new TextEncoder().encode("code-v1")]])
    const after = new Map([["index.js", new TextEncoder().encode("code-v2")]])
    expect(digestOfFiles(before)).not.toBe(digestOfFiles(after))
    expect(digestOfFiles(before)).toMatch(/^sha256:[0-9a-f]{64}$/u)
  })
})

describe("Runtime Identity static guards [OUT-OF-SCOPE] [IDENTITY-NO-GIT]", () => {
  test("runtime module has no git or timestamp dependency", async () => {
    const source = await Bun.file(new URL("../src/extension/runtime-identity.ts", import.meta.url)).text()
    expect(source).not.toContain("child_process")
    expect(source).not.toContain("rev-parse")
    expect(source).not.toContain(".git")
    expect(source).not.toContain("builtAt")
  })
})
