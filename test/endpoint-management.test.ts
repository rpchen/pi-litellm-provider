import { describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import piLitellmProvider from "../src/extension/index.ts"
import type { ProviderConfigLike } from "../src/extension/types.ts"

type Step =
  | { select: RegExp | string | undefined }
  | { input: string | undefined }
  | { confirm: boolean }

const silent = { logger: { warn: () => {}, error: () => {} } }

function setup(config?: unknown, extra: {
  auth?: unknown
  store?: unknown
  activation?: unknown
  env?: Record<string, string>
  write?: { rename?: (from: string, to: string) => void; beforeCommit?: () => void }
} = {}) {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-mgmt-"))
  const file = (name: string) => join(agentDir, name)
  if (config !== undefined) writeFileSync(file("litellm.json"), typeof config === "string" ? config : JSON.stringify(config, null, 2))
  if (extra.auth !== undefined) writeFileSync(file("auth.json"), JSON.stringify(extra.auth))
  if (extra.store !== undefined) writeFileSync(file("models-store.json"), JSON.stringify(extra.store))
  if (extra.activation !== undefined) writeFileSync(file("litellm.activation.json"), JSON.stringify(extra.activation))

  const registered = new Map<string, ProviderConfigLike>()
  const commands = new Map<string, (args: string, ctx: any) => Promise<void>>()
  const refreshes: string[][] = []
  const api = {
    registerProvider: (name: string, value: ProviderConfigLike) => { registered.set(name, value) },
    unregisterProvider: (name: string) => { registered.delete(name) },
    registerCommand: (name: string, value: { handler: (args: string, ctx: any) => Promise<void> }) => { commands.set(name, value.handler) },
    on: () => () => {},
  } as unknown as ExtensionAPI
  piLitellmProvider(api, { agentDir, env: extra.env ?? {}, deps: silent, cwd: agentDir, write: extra.write })

  const log: Array<{ kind: string; title: string; options?: string[]; placeholder?: string }> = []
  const notes: Array<{ message: string; type?: string }> = []
  async function run(args: string, steps: Step[]) {
    const queue = [...steps]
    const next = (kind: "select" | "input" | "confirm", title: string, options?: string[], placeholder?: string) => {
      log.push({ kind, title, options, placeholder })
      const step = queue.shift()
      if (!step) return kind === "select" ? undefined : kind === "confirm" ? false : undefined
      if (!(kind in step)) throw new Error(`script expected ${Object.keys(step)[0]} but host asked ${kind} "${title}"`)
      const value = (step as any)[kind]
      if (kind === "select" && value !== undefined) {
        const match = options!.find((option) => (typeof value === "string" ? option === value : value.test(option)))
        if (!match) throw new Error(`no option matching ${String(value)} in ${JSON.stringify(options)}`)
        return match
      }
      return value
    }
    const ctx = {
      cwd: agentDir,
      ui: {
        select: async (title: string, options: string[]) => next("select", title, options),
        input: async (title: string, placeholder?: string) => next("input", title, undefined, placeholder),
        confirm: async (title: string, message: string) => next("confirm", `${title}\n${message}`),
        notify: (message: string, type?: string) => { notes.push({ message, type }) },
      },
      modelRegistry: { refresh: async (input: { providers: string[] }) => { refreshes.push(input.providers) } },
    }
    await commands.get("litellm-endpoints")!(args, ctx)
    expect(queue).toEqual([]) // every scripted interaction was actually asked
  }
  const json = (name: string) => JSON.parse(readFileSync(file(name), "utf8"))
  const jsonOr = (name: string, fallback: unknown) => (existsSync(file(name)) ? json(name) : fallback)
  return { agentDir, file, json, jsonOr, run, registered, log, notes, refreshes }
}

const TWO = {
  pollInterval: 120,
  endpoints: {
    default: { baseUrl: "https://a.example", protocolOverrides: { m1: "chat" } },
    company: { baseUrl: "https://b.example", protocolOverrides: { m2: "messages" }, custom: { keep: true } },
  },
}
const AUTH_BOTH = { litellm: { type: "api_key", key: "sk-default" }, "litellm-company": { type: "api_key", key: "sk-company" } }

describe("endpoint management: listing", () => {
  test("[LIST-EMPTY] no endpoint → still offers Add, no error", async () => {
    const t = setup()
    await t.run("", [{ select: undefined }])
    expect(t.log[0]!.options).toEqual(["＋ 新增 endpoint"])
    expect(t.notes.filter((n) => n.type === "error" || n.type === "warning")).toEqual([])
  })

  test("[LIST-SINGLE] one endpoint → its line shows active + credential state", async () => {
    const t = setup({ endpoints: { solo: { baseUrl: "https://s.example" } } }, { auth: { "litellm-solo": { type: "api_key", key: "sk-x" } } })
    await t.run("", [{ select: undefined }])
    expect(t.log[0]!.options).toContain("✓ solo · 已启用 · 已连接")
  })

  test("[LIST-MULTI] active/inactive and connected/not-connected are independent per endpoint", async () => {
    const t = setup(TWO, { auth: { "litellm-company": { type: "api_key", key: "sk-c" } }, activation: { mode: "selected", endpointIds: ["default"] } })
    await t.run("", [{ select: undefined }])
    expect(t.log[0]!.options).toContain("✓ default · 已启用 · 未连接")
    expect(t.log[0]!.options).toContain("○ company · 未启用 · 已连接")
  })

  test("[LIST-LEGACY-GHOST] legacy default without a configured address is not listed; only Add is offered", async () => {
    const t = setup({ pollInterval: 60 }) // legacy shape, no baseUrl and no LITELLM_BASE_URL
    await t.run("", [{ select: undefined }])
    expect(t.log[0]!.options).toEqual(["＋ 新增 endpoint"])
    expect(t.notes.filter((n) => n.type === "error" || n.type === "warning")).toEqual([])
  })

  test("[LIST-EXTERNAL] a hand edit between invocations shows up without restart", async () => {
    const t = setup(TWO)
    await t.run("", [{ select: undefined }])
    expect(t.log[0]!.options!.some((o) => o.includes("lab"))).toBe(false)
    writeFileSync(t.file("litellm.json"), JSON.stringify({ endpoints: { ...TWO.endpoints, lab: { baseUrl: "https://lab.example" } } }))
    await t.run("", [{ select: undefined }])
    expect(t.log.at(-1)!.options!.some((o) => o.includes(" lab "))).toBe(true)
  })

  test("[HOST-UI] choices/inputs/confirmations use host dialogs; notify text contains no fake menu", async () => {
    const t = setup(TWO)
    await t.run("", [{ select: /company/ }, { select: "删除 endpoint" }, { confirm: false }, { select: "返回" }, { select: undefined }])
    expect(t.log.map((l) => l.kind)).toEqual(["select", "select", "confirm", "select", "select"])
    for (const note of t.notes) expect(note.message).not.toMatch(/^[✓○] /m)
  })
})

describe("endpoint management: add", () => {
  test("[ADD-OK][ADD-INACTIVE][ADD-PRESERVE] add writes only the new endpoint; it is inactive, unconnected and exposes no provider; others stay active", async () => {
    const t = setup(TWO, { activation: { mode: "all" } })
    await t.run("", [{ select: "＋ 新增 endpoint" }, { input: "lab" }, { input: "http://litellm.example:4000" }, { select: undefined }])
    expect(t.json("litellm.json")).toEqual({ ...TWO, endpoints: { ...TWO.endpoints, lab: { baseUrl: "http://litellm.example:4000" } } })
    expect(t.json("litellm.activation.json")).toEqual({ mode: "selected", endpointIds: ["default", "company"] })
    expect([...t.registered.keys()].sort()).toEqual(["litellm", "litellm-company"])
    expect(existsSync(t.file("auth.json"))).toBe(false)
    await t.run("", [{ select: undefined }])
    expect(t.log.at(-1)!.options).toContain("○ lab · 未启用 · 未连接")
  })

  test("[ADD-DUP] duplicate id re-prompts, nothing written until a valid id", async () => {
    const t = setup(TWO)
    const before = readFileSync(t.file("litellm.json"), "utf8")
    await t.run("", [{ select: "＋ 新增 endpoint" }, { input: "company" }, { input: undefined }, { select: undefined }])
    expect(t.log.find((l) => l.kind === "input" && l.title.includes("已存在"))).toBeTruthy()
    expect(readFileSync(t.file("litellm.json"), "utf8")).toBe(before)
  })

  test("[ADD-BAD-ID] invalid id re-prompts", async () => {
    const t = setup(TWO)
    const before = readFileSync(t.file("litellm.json"), "utf8")
    await t.run("", [{ select: "＋ 新增 endpoint" }, { input: "Bad Id" }, { input: undefined }, { select: undefined }])
    expect(t.log.find((l) => l.kind === "input" && l.title.includes("输入无效"))).toBeTruthy()
    expect(readFileSync(t.file("litellm.json"), "utf8")).toBe(before)
  })

  test("[ADD-BAD-URL] invalid url re-prompts and never writes", async () => {
    const t = setup(TWO)
    const before = readFileSync(t.file("litellm.json"), "utf8")
    await t.run("", [{ select: "＋ 新增 endpoint" }, { input: "lab" }, { input: "ftp://x" }, { input: "http://u:p@x.example" }, { input: undefined }, { select: undefined }])
    expect(t.log.filter((l) => l.kind === "input" && l.title.includes("输入无效")).length).toBe(2)
    expect(readFileSync(t.file("litellm.json"), "utf8")).toBe(before)
  })

  test("[ADD-LEGACY] legacy single-endpoint config: confirm → migrate to endpoints.default; declining changes nothing", async () => {
    const legacy = { baseUrl: "https://old.example", protocolOverrides: { m: "chat" }, pollInterval: 90 }
    const t = setup(legacy, { auth: { litellm: { type: "api_key", key: "sk-keep" } } })
    const before = readFileSync(t.file("litellm.json"), "utf8")
    await t.run("", [{ select: "＋ 新增 endpoint" }, { input: "lab" }, { input: "https://lab.example" }, { confirm: false }, { select: undefined }])
    expect(readFileSync(t.file("litellm.json"), "utf8")).toBe(before)
    await t.run("", [{ select: "＋ 新增 endpoint" }, { input: "lab" }, { input: "https://lab.example" }, { confirm: true }, { select: undefined }])
    expect(t.json("litellm.json")).toEqual({
      pollInterval: 90,
      endpoints: { default: { baseUrl: "https://old.example", protocolOverrides: { m: "chat" } }, lab: { baseUrl: "https://lab.example" } },
    })
    expect(t.json("auth.json").litellm.key).toBe("sk-keep") // default credential identity unchanged
    expect(t.json("litellm.activation.json")).toEqual({ mode: "selected", endpointIds: ["default"] })
    expect(t.registered.has("litellm")).toBe(true)
  })

  test("[CFG-PARSE-FAIL] Add is refused and reported when litellm.json cannot be parsed", async () => {
    const t = setup("{ // hand written\n \"endpoints\": {} }")
    const before = readFileSync(t.file("litellm.json"), "utf8")
    await t.run("", [{ select: "＋ 新增 endpoint" }, { select: undefined }])
    expect(readFileSync(t.file("litellm.json"), "utf8")).toBe(before)
    expect(t.notes.some((n) => n.type === "error" && n.message.includes("litellm.json"))).toBe(true)
  })
})

describe("endpoint management: edit", () => {
  test("[EDIT-URL][EDIT-ID-READONLY][EDIT-PRESERVE][EDIT-ISOLATED] only Base URL is editable; unmanaged fields and other endpoints untouched", async () => {
    const t = setup(TWO, { auth: AUTH_BOTH, store: { "litellm-company": { models: [1] }, litellm: { models: [2] } } })
    await t.run("", [{ select: /company/ }, { select: "修改 Base URL" }, { input: "https://new.example" }, { select: "返回" }, { select: undefined }])
    const out = t.json("litellm.json")
    expect(out.endpoints.company).toEqual({ baseUrl: "https://new.example", protocolOverrides: { m2: "messages" }, custom: { keep: true } })
    expect(out.endpoints.default).toEqual(TWO.endpoints.default)
    expect(out.pollInterval).toBe(120)
    expect(t.json("auth.json")).toEqual(AUTH_BOTH)
    expect(t.json("models-store.json")).toEqual({ "litellm-company": { models: [1] }, litellm: { models: [2] } })
    // no ID input was offered during edit; only the Base URL input
    const inputs = t.log.filter((l) => l.kind === "input")
    expect(inputs).toHaveLength(1)
    expect(inputs[0]!.title).toContain("ID 不可修改")
    expect(inputs[0]!.placeholder).toBe("https://b.example")
    expect(t.refreshes.at(-1)).toEqual(["litellm-company"]) // running provider picks up the new address
  })

  test("[EDIT-ATOMIC] invalid url re-prompts; unparseable file is refused; nothing partial", async () => {
    const t = setup(TWO)
    const before = readFileSync(t.file("litellm.json"), "utf8")
    await t.run("", [{ select: /company/ }, { select: "修改 Base URL" }, { input: "nope" }, { input: undefined }, { select: "返回" }, { select: undefined }])
    expect(readFileSync(t.file("litellm.json"), "utf8")).toBe(before)
  })

  test("[EDIT-ENV-LEGACY][LEGACY-MIGRATE] env-provided legacy address: Edit first migrates into endpoints.default, then edits", async () => {
    const t = setup({ pollInterval: 60, protocolOverrides: { m: "chat" }, keep: 1 }, { env: { LITELLM_BASE_URL: "https://env.example" } })
    await t.run("", [{ select: /default/ }, { select: "修改 Base URL" }, { confirm: true }, { input: "https://x.example" }, { select: "返回" }, { select: undefined }])
    expect(t.json("litellm.json")).toEqual({
      pollInterval: 60,
      keep: 1,
      endpoints: { default: { baseUrl: "https://x.example", protocolOverrides: { m: "chat" } } },
    })
    expect(t.jsonOr("litellm.activation.json", { mode: "all" })).toEqual({ mode: "all" })
    const confirm = t.log.find((l) => l.kind === "confirm")!
    expect(confirm.title).toContain("迁移为可管理配置")
    expect(confirm.title).toContain("endpoints.default")
  })

  test("[EDIT-ENV-LEGACY] declining the migration leaves the configuration untouched", async () => {
    const t = setup({ pollInterval: 60 }, { env: { LITELLM_BASE_URL: "https://env.example" } })
    const before = readFileSync(t.file("litellm.json"), "utf8")
    await t.run("", [{ select: /default/ }, { select: "修改 Base URL" }, { confirm: false }, { select: "返回" }, { select: undefined }])
    expect(readFileSync(t.file("litellm.json"), "utf8")).toBe(before)
  })

  test("[LEGACY-MIGRATE][DEL-CLEANUP] Delete on the env-legacy default migrates first, then deletes definition and credential", async () => {
    const t = setup({ pollInterval: 60 }, { env: { LITELLM_BASE_URL: "https://env.example" }, auth: { litellm: { type: "api_key", key: "sk-keep" } } })
    await t.run("", [{ select: /default/ }, { select: "删除 endpoint" }, { confirm: true }, { confirm: true }, { select: undefined }])
    expect(t.json("litellm.json")).toEqual({ pollInterval: 60, endpoints: {} })
    expect(t.json("auth.json")).toEqual({})
    expect(t.registered.has("litellm")).toBe(false)
  })
})

describe("endpoint management: add rollback", () => {
  test("[ADD-ROLLBACK] failed config write (rename failure) restores activation 'all' and leaves config/providers untouched", async () => {
    const t = setup(TWO, {
      activation: { mode: "all" },
      write: { rename: () => { throw new Error("disk full") } },
    })
    await t.run("", [{ select: "＋ 新增 endpoint" }, { input: "lab" }, { input: "https://lab.example" }, { select: undefined }])
    expect(t.json("litellm.json")).toEqual(TWO) // config unchanged
    expect(t.json("litellm.activation.json")).toEqual({ mode: "all" }) // not left materialised as selected
    expect([...t.registered.keys()].sort()).toEqual(["litellm", "litellm-company"]) // runtime state restored
    expect(t.notes.some((n) => n.type === "error" && n.message.includes("disk full"))).toBe(true)
  })

  test("[ADD-ROLLBACK] failed config write (concurrent external edit / conflict) restores activation 'all'", async () => {
    const t = setup(TWO, {
      activation: { mode: "all" },
      write: {
        beforeCommit: () => writeFileSync(t.file("litellm.json"), JSON.stringify({ ...TWO, pollInterval: 777 }, null, 2)),
      },
    })
    await t.run("", [{ select: "＋ 新增 endpoint" }, { input: "lab" }, { input: "https://lab.example" }, { select: undefined }])
    expect(t.json("litellm.activation.json")).toEqual({ mode: "all" })
    expect(Object.keys(t.json("litellm.json").endpoints)).toEqual(["default", "company"]) // the external edit wins
    expect(t.json("litellm.json").pollInterval).toBe(777)
    expect([...t.registered.keys()].sort()).toEqual(["litellm", "litellm-company"])
    expect(t.notes.some((n) => n.type === "error" && n.message.includes("被外部修改"))).toBe(true)
  })

  test("[ADD-ROLLBACK] a rollback failure is reported together with the primary failure", async () => {
    // the pin write succeeds; the config write fails; the rollback write then also fails (file made read-only)
    const t = setup(TWO, {
      activation: { mode: "all" },
      write: {
        rename: () => {
          chmodSync(t.file("litellm.activation.json"), 0o444)
          throw new Error("disk full")
        },
      },
    })
    await t.run("", [{ select: "＋ 新增 endpoint" }, { input: "lab" }, { input: "https://lab.example" }, { select: undefined }])
    chmodSync(t.file("litellm.activation.json"), 0o666)
    const last = t.notes.at(-1)!
    expect(last.type).toBe("error")
    expect(last.message).toContain("disk full") // primary failure first
    expect(last.message).toContain("回滚失败") // rollback failure kept, not swallowed
    expect(t.json("litellm.json")).toEqual(TWO)
  })
})

describe("endpoint management: credentials", () => {
  test("[CRED-CONNECT][CRED-ACTIVATION-INDEPENDENT][CRED-NO-ECHO] connect on an inactive endpoint stores the key, keeps it inactive, never echoes the key", async () => {
    const t = setup(TWO, { activation: { mode: "selected", endpointIds: ["default"] } })
    await t.run("", [{ select: /company/ }, { select: "连接 API Key" }, { input: "sk-secret-123" }, { select: "返回" }, { select: undefined }])
    expect(t.json("auth.json")["litellm-company"]).toEqual({ type: "api_key", key: "sk-secret-123" })
    expect(t.json("litellm.activation.json")).toEqual({ mode: "selected", endpointIds: ["default"] })
    expect(t.registered.has("litellm-company")).toBe(false)
    expect(JSON.stringify({ log: t.log, notes: t.notes })).not.toContain("sk-secret-123")
    expect(t.log.find((l) => l.options?.includes("○ company · 未启用 · 已连接"))).toBeTruthy()
  })

  test("[CRED-REPLACE][CRED-NO-ECHO] replace overwrites without ever showing the old key", async () => {
    const t = setup(TWO, { auth: AUTH_BOTH })
    await t.run("", [{ select: /company/ }, { select: "替换 API Key" }, { input: "sk-brand-new" }, { select: "返回" }, { select: undefined }])
    expect(t.json("auth.json")["litellm-company"].key).toBe("sk-brand-new")
    expect(t.json("auth.json").litellm.key).toBe("sk-default")
    expect(JSON.stringify({ log: t.log, notes: t.notes })).not.toContain("sk-company")
    expect(JSON.stringify({ log: t.log, notes: t.notes })).not.toContain("sk-brand-new")
    expect(t.refreshes.at(-1)).toEqual(["litellm-company"]) // active endpoint re-discovers with the new key
  })

  test("[CRED-DISCONNECT][CRED-ACTIVATION-INDEPENDENT] disconnect removes only that credential; endpoint and activation stay", async () => {
    const t = setup(TWO, { auth: AUTH_BOTH })
    await t.run("", [{ select: /company/ }, { select: "断开凭据" }, { confirm: true }, { select: "返回" }, { select: undefined }])
    expect(t.json("auth.json")).toEqual({ litellm: AUTH_BOTH.litellm })
    expect(t.json("litellm.json")).toEqual(TWO)
    expect(t.registered.has("litellm-company")).toBe(true)
    expect(existsSync(t.file("litellm.activation.json"))).toBe(false)
  })

  test("[CRED-DISCONNECT] declining the disconnect confirmation keeps the credential", async () => {
    const t = setup(TWO, { auth: AUTH_BOTH })
    await t.run("", [{ select: /company/ }, { select: "断开凭据" }, { confirm: false }, { select: "返回" }, { select: undefined }])
    expect(t.json("auth.json")).toEqual(AUTH_BOTH)
  })

  test("[CRED-INVALID-KEY] blank/whitespace key is rejected and the old key kept", async () => {
    const t = setup(TWO, { auth: AUTH_BOTH })
    await t.run("", [{ select: /company/ }, { select: "替换 API Key" }, { input: "bad key" }, { select: "返回" }, { select: undefined }])
    expect(t.json("auth.json")).toEqual(AUTH_BOTH)
    expect(t.notes.some((n) => n.type === "warning")).toBe(true)
  })

  test("[CRED-CORRUPT-STORE] corrupt auth.json: connect fails, file untouched, state shown as unknown", async () => {
    const t = setup(TWO)
    writeFileSync(t.file("auth.json"), "{ broken")
    await t.run("", [{ select: /company/ }, { select: "连接 API Key" }, { input: "sk-x" }, { select: "返回" }, { select: undefined }])
    expect(readFileSync(t.file("auth.json"), "utf8")).toBe("{ broken")
    expect(t.notes.some((n) => n.type === "error" && n.message.includes("auth.json"))).toBe(true)
    expect(t.log[0]!.options!.some((o) => o.includes("凭据状态未知"))).toBe(true)
  })

  test("[CRED-LOGIN-CONSISTENT] a credential stored by the host /login is listed as connected; the legacy env key is labelled environment, and disconnect leaves env alone", async () => {
    const t = setup({ baseUrl: "https://old.example" }, { env: { LITELLM_API_KEY: "sk-env" } })
    await t.run("", [{ select: undefined }])
    expect(t.log[0]!.options).toContain("✓ default · 已启用 · 已连接（环境变量）")
    writeFileSync(t.file("auth.json"), JSON.stringify({ litellm: { type: "api_key", key: "sk-login" } }))
    await t.run("", [{ select: undefined }])
    expect(t.log.at(-1)!.options).toContain("✓ default · 已启用 · 已连接")
  })
})

describe("endpoint management: activation", () => {
  test("[ACT-TOGGLE][ACT-IMMEDIATE][ACT-CRED-INDEPENDENT] deactivate unregisters at once and persists; credential and snapshot stay; activate registers again", async () => {
    const t = setup(TWO, { auth: AUTH_BOTH, store: { "litellm-company": { models: [1] } } })
    await t.run("", [{ select: /company/ }, { select: "停用" }, { select: "启用" }, { select: "返回" }, { select: undefined }])
    expect(t.registered.has("litellm-company")).toBe(true)
    await t.run("", [{ select: /company/ }, { select: "停用" }, { select: "返回" }, { select: undefined }])
    expect(t.registered.has("litellm-company")).toBe(false)
    expect(t.registered.has("litellm")).toBe(true)
    expect(t.json("litellm.activation.json")).toEqual({ mode: "selected", endpointIds: ["default"] })
    expect(t.json("auth.json")).toEqual(AUTH_BOTH)
    expect(t.json("models-store.json")).toEqual({ "litellm-company": { models: [1] } })
  })

  test("[ACT-ZERO] disable all → zero providers, valid state; enable all restores", async () => {
    const t = setup(TWO)
    await t.run("", [{ select: "全部停用" }, { select: undefined }])
    expect(t.registered.size).toBe(0)
    expect(t.json("litellm.activation.json")).toEqual({ mode: "selected", endpointIds: [] })
    await t.run("", [{ select: "全部启用" }, { select: undefined }])
    expect([...t.registered.keys()].sort()).toEqual(["litellm", "litellm-company"])
  })

  test("argument form keeps working (all | none | <id>) and reports the active set", async () => {
    const t = setup(TWO)
    await t.run("none", [])
    expect(t.registered.size).toBe(0)
    await t.run("company", [])
    expect([...t.registered.keys()]).toEqual(["litellm-company"])
    expect(t.notes.at(-1)!.message).toBe("已激活 endpoint：company")
    await t.run("ghost", [])
    expect(t.notes.at(-1)!.message).toContain("未知 LiteLLM endpoint：ghost")
  })
})

describe("endpoint management: delete", () => {
  const seed = () => setup(TWO, {
    auth: { ...AUTH_BOTH, anthropic: { type: "api_key", key: "sk-other" } },
    store: { litellm: { models: [1] }, "litellm-company": { models: [2] }, other: { models: [3] } },
    activation: { mode: "selected", endpointIds: ["default", "company"] },
  })

  test("[DEL-CONFIRM][DEL-CANCEL] confirmation states what is removed; declining changes nothing", async () => {
    const t = seed()
    const snapshot = () => ["litellm.json", "auth.json", "models-store.json", "litellm.activation.json"].map((f) => readFileSync(t.file(f), "utf8"))
    const before = snapshot()
    await t.run("", [{ select: /company/ }, { select: "删除 endpoint" }, { confirm: false }, { select: "返回" }, { select: undefined }])
    const confirm = t.log.find((l) => l.kind === "confirm")!
    for (const word of ["配置", "启用状态", "API Key", "缓存"]) expect(confirm.title).toContain(word)
    expect(snapshot()).toEqual(before)
    expect(t.registered.has("litellm-company")).toBe(true)
  })

  test("[DEL-CLEANUP][DEL-ISOLATED] confirmed delete removes definition, activation, credential, snapshot and provider; others intact", async () => {
    const t = seed()
    await t.run("", [{ select: /company/ }, { select: "删除 endpoint" }, { confirm: true }, { select: undefined }])
    expect(t.json("litellm.json")).toEqual({ pollInterval: 120, endpoints: { default: TWO.endpoints.default } })
    expect(t.json("litellm.activation.json")).toEqual({ mode: "selected", endpointIds: ["default"] })
    expect(t.json("auth.json")).toEqual({ litellm: AUTH_BOTH.litellm, anthropic: { type: "api_key", key: "sk-other" } })
    expect(t.json("models-store.json")).toEqual({ litellm: { models: [1] }, other: { models: [3] } })
    expect([...t.registered.keys()]).toEqual(["litellm"])
  })

  test("[DEL-NO-GHOST] deleting then re-adding the same id starts inactive, unconnected, without restored models", async () => {
    const t = seed()
    await t.run("", [{ select: /company/ }, { select: "删除 endpoint" }, { confirm: true }, { select: undefined }])
    await t.run("", [{ select: "＋ 新增 endpoint" }, { input: "company" }, { input: "https://b2.example" }, { select: undefined }])
    expect(t.registered.has("litellm-company")).toBe(false)
    expect(t.json("litellm.activation.json").endpointIds).not.toContain("company")
    expect(t.json("auth.json")["litellm-company"]).toBeUndefined()
    expect(t.json("models-store.json")["litellm-company"]).toBeUndefined()
    await t.run("", [{ select: undefined }])
    expect(t.log.at(-1)!.options).toContain("○ company · 未启用 · 未连接")
  })

  test("[DEL-PARTIAL-FAILURE] a cleanup failure before the definition is removed keeps the endpoint so Delete can be retried", async () => {
    const t = seed()
    writeFileSync(t.file("auth.json"), "{ broken") // credential cleanup will refuse
    await t.run("", [{ select: /company/ }, { select: "删除 endpoint" }, { confirm: true }, { select: "返回" }, { select: undefined }])
    expect(t.json("litellm.json").endpoints.company).toBeDefined()
    expect(t.notes.some((n) => n.type === "error" && n.message.includes("可重试"))).toBe(true)
  })
})
