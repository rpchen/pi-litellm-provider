import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ConfigStoreError, inspectConfig, mutateConfig, validateBaseUrl } from "../src/extension/config-store.ts"

function setup(content?: string) {
  const dir = mkdtempSync(join(tmpdir(), "pi-cfgstore-"))
  const path = join(dir, "litellm.json")
  if (content !== undefined) writeFileSync(path, content)
  return { dir, path, read: () => JSON.parse(readFileSync(path, "utf8")) }
}

const ADVANCED = {
  pollInterval: 120,
  contextTierCap: false,
  futureField: { nested: [1, 2] },
  endpoints: {
    default: { baseUrl: "https://a.example", protocolOverrides: { "m-1": "chat" }, extra: "keep" },
    company: { baseUrl: "https://b.example", protocolOverrides: { "m-2": "messages" }, note: { x: 1 } },
  },
}

async function code(promise: Promise<unknown>): Promise<string | undefined> {
  try { await promise } catch (error) { return error instanceof ConfigStoreError ? error.code : `other:${String(error)}` }
  return undefined
}

describe("config-store", () => {
  test("[ADD-OK] adds a valid endpoint to an absent file", async () => {
    const t = setup()
    await mutateConfig(t.path, { kind: "add", id: "company", baseUrl: " http://litellm.example:4000 " }, { env: {} })
    expect(t.read()).toEqual({ endpoints: { company: { baseUrl: "http://litellm.example:4000" } } })
  })

  test("[ADD-DUP] duplicate id is rejected without writing", async () => {
    const t = setup(JSON.stringify(ADVANCED))
    const before = readFileSync(t.path, "utf8")
    expect(await code(mutateConfig(t.path, { kind: "add", id: "company", baseUrl: "https://c.example" }, { env: {} }))).toBe("duplicate")
    expect(readFileSync(t.path, "utf8")).toBe(before)
  })

  test("[ADD-DUP] an entry the loader would skip still counts as existing", async () => {
    const t = setup(JSON.stringify({ endpoints: { broken: { baseUrl: "not-a-url" } } }))
    expect(inspectConfig(t.path, {}).ids).toEqual(["broken"])
    expect(await code(mutateConfig(t.path, { kind: "add", id: "broken", baseUrl: "https://c.example" }, { env: {} }))).toBe("duplicate")
  })

  test.each(["Company", "-x", "a b", "", "a/b", "x".repeat(0)])("[ADD-BAD-ID] rejects id %p", async (id) => {
    const t = setup(JSON.stringify(ADVANCED))
    const before = readFileSync(t.path, "utf8")
    expect(await code(mutateConfig(t.path, { kind: "add", id, baseUrl: "https://c.example" }, { env: {} }))).toBe("invalid-id")
    expect(readFileSync(t.path, "utf8")).toBe(before)
  })

  test.each(["", "   ", "litellm.example:4000", "ftp://x.example", "javascript:alert(1)", "http://user:pw@x.example", "not a url"])(
    "[ADD-BAD-URL] rejects base url %p",
    async (baseUrl) => {
      const t = setup(JSON.stringify(ADVANCED))
      const before = readFileSync(t.path, "utf8")
      expect(await code(mutateConfig(t.path, { kind: "add", id: "new", baseUrl }, { env: {} }))).toBe("invalid-url")
      expect(readFileSync(t.path, "utf8")).toBe(before)
      expect(validateBaseUrl(baseUrl).ok).toBe(false)
    },
  )

  test("[ADD-PRESERVE][CFG-NON-DESTRUCTIVE] add keeps every other endpoint, field and global setting", async () => {
    const t = setup(JSON.stringify(ADVANCED, null, 4))
    await mutateConfig(t.path, { kind: "add", id: "lab", baseUrl: "https://lab.example" }, { env: {} })
    expect(t.read()).toEqual({ ...ADVANCED, endpoints: { ...ADVANCED.endpoints, lab: { baseUrl: "https://lab.example" } } })
    expect(Object.keys(t.read().endpoints)).toEqual(["default", "company", "lab"])
    expect(readFileSync(t.path, "utf8").split("\n")[1] ?? "").toStartWith("    ") // indentation preserved
  })

  test("[EDIT-URL][EDIT-PRESERVE] edit changes only baseUrl and keeps protocolOverrides/unknown fields", async () => {
    const t = setup(JSON.stringify(ADVANCED))
    await mutateConfig(t.path, { kind: "edit", id: "company", baseUrl: "https://new.example" }, { env: {} })
    const out = t.read()
    expect(out.endpoints.company).toEqual({ baseUrl: "https://new.example", protocolOverrides: { "m-2": "messages" }, note: { x: 1 } })
    expect(out.endpoints.default).toEqual(ADVANCED.endpoints.default) // [EDIT-ISOLATED]
    expect(out.futureField).toEqual(ADVANCED.futureField)
    expect(out.pollInterval).toBe(120)
  })

  test("[EDIT-ID-READONLY] edit cannot introduce or rename an id", async () => {
    const t = setup(JSON.stringify(ADVANCED))
    expect(await code(mutateConfig(t.path, { kind: "edit", id: "missing", baseUrl: "https://x.example" }, { env: {} }))).toBe("not-found")
    expect(Object.keys(t.read().endpoints)).toEqual(["default", "company"])
  })

  test("[DEL-ISOLATED] delete removes only the target endpoint and keeps an empty endpoints object explicit", async () => {
    const t = setup(JSON.stringify(ADVANCED))
    await mutateConfig(t.path, { kind: "delete", id: "company" }, { env: {} })
    expect(t.read().endpoints).toEqual({ default: ADVANCED.endpoints.default })
    await mutateConfig(t.path, { kind: "delete", id: "default" }, { env: {} })
    expect(t.read().endpoints).toEqual({})
    expect(inspectConfig(t.path, {}).mode).toBe("explicit")
    expect(await code(mutateConfig(t.path, { kind: "delete", id: "default" }, { env: {} }))).toBe("not-found")
  })

  test("[CFG-PARSE-FAIL] unparseable or non-object file is refused and left unchanged", async () => {
    for (const content of ["{ // comment\n \"endpoints\": {} }", "{not json", "[]", "\"x\""]) {
      const t = setup(content)
      const c = await code(mutateConfig(t.path, { kind: "add", id: "a", baseUrl: "https://a.example" }, { env: {} }))
      expect(["parse", "shape"]).toContain(c ?? "none")
      expect(readFileSync(t.path, "utf8")).toBe(content)
      expect(readdirSync(t.dir)).toEqual(["litellm.json"])
    }
  })

  test("[CFG-PARSE-FAIL] endpoints that is not an object, or mixed legacy+endpoints, is refused", async () => {
    const a = setup(JSON.stringify({ endpoints: [] }))
    expect(await code(mutateConfig(a.path, { kind: "add", id: "a", baseUrl: "https://a.example" }, { env: {} }))).toBe("shape")
    const b = setup(JSON.stringify({ baseUrl: "https://x.example", endpoints: {} }))
    expect(await code(mutateConfig(b.path, { kind: "add", id: "a", baseUrl: "https://a.example" }, { env: {} }))).toBe("legacy-conflict")
  })

  test("[EDIT-ATOMIC] interrupted replace leaves the original file and no temp file", async () => {
    const t = setup(JSON.stringify(ADVANCED))
    const before = readFileSync(t.path, "utf8")
    await expect(
      mutateConfig(t.path, { kind: "add", id: "lab", baseUrl: "https://lab.example" }, { env: {}, rename: () => { throw new Error("disk full") } }),
    ).rejects.toThrow("disk full")
    expect(readFileSync(t.path, "utf8")).toBe(before)
    expect(readdirSync(t.dir)).toEqual(["litellm.json"])
  })

  test("[CFG-CONFLICT] an external edit between read and replace aborts the write", async () => {
    const t = setup(JSON.stringify(ADVANCED))
    const external = JSON.stringify({ ...ADVANCED, pollInterval: 999 })
    const c = await code(mutateConfig(t.path, { kind: "add", id: "lab", baseUrl: "https://lab.example" }, {
      env: {},
      beforeCommit: () => writeFileSync(t.path, external),
    }))
    expect(c).toBe("conflict")
    expect(readFileSync(t.path, "utf8")).toBe(external) // external change not overwritten
    expect(readdirSync(t.dir)).toEqual(["litellm.json"])
  })

  test("[ADD-LEGACY] legacy file address + protocolOverrides migrate into endpoints.default", async () => {
    const t = setup(JSON.stringify({ baseUrl: "https://old.example", protocolOverrides: { m: "chat" }, pollInterval: 60, keep: 1 }))
    expect(inspectConfig(t.path, {})).toEqual({ mode: "legacy", ids: ["default"] })
    const outcome = await mutateConfig(t.path, { kind: "add", id: "company", baseUrl: "https://c.example" }, { env: {} })
    expect(outcome).toEqual({ migratedLegacy: true, fromEnvironment: false })
    expect(t.read()).toEqual({
      pollInterval: 60,
      keep: 1,
      endpoints: {
        default: { baseUrl: "https://old.example", protocolOverrides: { m: "chat" } },
        company: { baseUrl: "https://c.example" },
      },
    })
  })

  test("[ADD-LEGACY] address from LITELLM_BASE_URL is materialised into endpoints.default", async () => {
    const t = setup(JSON.stringify({ pollInterval: 60 }))
    const env = { LITELLM_BASE_URL: "https://env.example" }
    expect(inspectConfig(t.path, env).ids).toEqual(["default"])
    const outcome = await mutateConfig(t.path, { kind: "add", id: "company", baseUrl: "https://c.example" }, { env })
    expect(outcome).toEqual({ migratedLegacy: true, fromEnvironment: true })
    expect(t.read().endpoints.default.baseUrl).toBe("https://env.example")
  })

  test("[ADD-LEGACY] unconfigured legacy default is not a phantom: the user may add their own 'default'", async () => {
    const t = setup(JSON.stringify({ protocolOverrides: { m: "chat" } }))
    expect(inspectConfig(t.path, {}).ids).toEqual([])
    await mutateConfig(t.path, { kind: "add", id: "default", baseUrl: "https://d.example" }, { env: {} })
    expect(t.read()).toEqual({ endpoints: { default: { baseUrl: "https://d.example", protocolOverrides: { m: "chat" } } } })
    const u = setup(JSON.stringify({ protocolOverrides: { m: "chat" } }))
    expect(await code(mutateConfig(u.path, { kind: "add", id: "x", baseUrl: "https://x.example" }, { env: {} }))).toBe("legacy-conflict")
  })

  test("[LEGACY-MIGRATE] migrate materialises the effective legacy address into endpoints.default", async () => {
    const t = setup(JSON.stringify({ pollInterval: 60, keep: 1, protocolOverrides: { m: "chat" } }))
    const outcome = await mutateConfig(t.path, { kind: "migrate" }, { env: { LITELLM_BASE_URL: "https://env.example" } })
    expect(outcome).toEqual({ migratedLegacy: true, fromEnvironment: true })
    expect(t.read()).toEqual({
      pollInterval: 60,
      keep: 1,
      endpoints: { default: { baseUrl: "https://env.example", protocolOverrides: { m: "chat" } } },
    })
    // after migration edit/delete work and migration is refused as unnecessary
    expect(await code(mutateConfig(t.path, { kind: "migrate" }, { env: {} }))).toBe("not-legacy")
    await mutateConfig(t.path, { kind: "edit", id: "default", baseUrl: "https://x.example" }, { env: {} })
    expect(t.read().endpoints.default.baseUrl).toBe("https://x.example")
  })

  test("[LEGACY-MIGRATE] migrate without any legacy address is refused and writes nothing", async () => {
    const t = setup(JSON.stringify({ pollInterval: 60 }))
    expect(await code(mutateConfig(t.path, { kind: "migrate" }, { env: {} }))).toBe("not-found")
    expect(t.read()).toEqual({ pollInterval: 60 })
  })

  test("[LEGACY-MIGRATE][EDIT-ATOMIC] a failed migrate leaves the file untouched (no partial config)", async () => {
    const t = setup(JSON.stringify({ baseUrl: "https://old.example", protocolOverrides: { m: "chat" }, keep: 1 }))
    const before = readFileSync(t.path, "utf8")
    await expect(
      mutateConfig(t.path, { kind: "migrate" }, { env: {}, rename: () => { throw new Error("disk full") } }),
    ).rejects.toThrow("disk full")
    expect(readFileSync(t.path, "utf8")).toBe(before)
  })

  test("legacy default edit/delete operate on the file; environment-provided address is refused", async () => {
    const t = setup(JSON.stringify({ baseUrl: "https://old.example", protocolOverrides: { m: "chat" }, pollInterval: 60 }))
    await mutateConfig(t.path, { kind: "edit", id: "default", baseUrl: "https://new.example" }, { env: {} })
    expect(t.read()).toEqual({ baseUrl: "https://new.example", protocolOverrides: { m: "chat" }, pollInterval: 60 })
    const env = { LITELLM_BASE_URL: "https://env.example" }
    expect(await code(mutateConfig(t.path, { kind: "edit", id: "default", baseUrl: "https://z.example" }, { env }))).toBe("env-managed") // [EDIT-ENV-LEGACY]
    expect(await code(mutateConfig(t.path, { kind: "delete", id: "default" }, { env }))).toBe("env-managed")
    await mutateConfig(t.path, { kind: "delete", id: "default" }, { env: {} })
    expect(t.read()).toEqual({ pollInterval: 60 })
  })
})
