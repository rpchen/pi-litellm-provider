import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  DEFAULT_ENDPOINT_ID,
  DEFAULT_POLL_INTERVAL_SECONDS,
  isConfigured,
  isEndpointId,
  loadConfig,
  loadEndpointRegistry,
} from "../src/extension/config.ts"

const silentLogger = { warn: () => {} }
const collectingLogger = () => {
  const warnings: string[] = []
  return { warnings, logger: { warn: (message: string) => warnings.push(message) } }
}

function makeDirs(): { cwd: string; agentDir: string } {
  const root = mkdtempSync(join(tmpdir(), "litellm-config-"))
  const cwd = join(root, "project")
  const agentDir = join(root, "agent")
  mkdirSync(cwd, { recursive: true })
  mkdirSync(agentDir, { recursive: true })
  return { cwd, agentDir }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value), "utf-8")
}

describe("PR9 全局 endpoint 配置", () => {
  test("legacy 配置零迁移映射到 default，env 只覆盖 default 地址", () => {
    const { cwd, agentDir } = makeDirs()
    writeJson(join(agentDir, "litellm.json"), {
      baseUrl: "http://global.example:4000",
      pollInterval: 120,
      protocolOverrides: { "glm-5.3": "chat" },
    })
    const registry = loadEndpointRegistry(cwd, silentLogger, { LITELLM_BASE_URL: "http://env.example:4000" }, agentDir)
    expect(registry.mode).toBe("legacy")
    expect(Object.keys(registry.endpoints)).toEqual([DEFAULT_ENDPOINT_ID])
    expect(registry.endpoints.default?.baseUrl).toBe("http://env.example:4000")
    expect(registry.endpoints.default?.pollInterval).toBe(120)
    expect(registry.endpoints.default?.protocolOverrides).toEqual({ "glm-5.3": "chat" })
    expect(loadConfig(cwd, silentLogger, {}, agentDir).baseUrl).toBe("http://global.example:4000")
  })

  test("项目 .pi/litellm.json 不再参与 endpoint 解析", () => {
    const { cwd, agentDir } = makeDirs()
    writeJson(join(cwd, ".pi", "litellm.json"), { baseUrl: "http://project.example:4000" })
    const registry = loadEndpointRegistry(cwd, silentLogger, {}, agentDir)
    expect(registry.endpoints.default?.baseUrl).toBe("")
    expect(isConfigured(registry.endpoints.default!)).toBeFalse()
  })

  test("显式 endpoints 继承全局 poll/context，protocolOverrides 保持 endpoint 级", () => {
    const { cwd, agentDir } = makeDirs()
    writeJson(join(agentDir, "litellm.json"), {
      pollInterval: 90,
      contextTierCap: false,
      endpoints: {
        default: {
          baseUrl: "https://primary.example/v1",
          protocolOverrides: { "gpt-x": "responses" },
        },
        company: {
          baseUrl: "https://company.example",
          protocolOverrides: { "claude-x": "messages" },
        },
      },
    })
    const registry = loadEndpointRegistry(cwd, silentLogger, { LITELLM_BASE_URL: "https://ignored.example" }, agentDir)
    expect(registry.mode).toBe("explicit")
    expect(Object.keys(registry.endpoints)).toEqual(["default", "company"])
    expect(registry.endpoints.default?.pollInterval).toBe(90)
    expect(registry.endpoints.company?.pollInterval).toBe(90)
    expect(registry.endpoints.company?.contextTierCap).toBeFalse()
    expect(registry.endpoints.default?.protocolOverrides).toEqual({ "gpt-x": "responses" })
    expect(registry.endpoints.company?.protocolOverrides).toEqual({ "claude-x": "messages" })
    expect(registry.endpoints.default?.baseUrl).toBe("https://primary.example/v1")
  })

  test("legacy endpoint 字段与 endpoints 共存时拒绝整个显式配置", () => {
    const { cwd, agentDir } = makeDirs()
    const { warnings, logger } = collectingLogger()
    writeJson(join(agentDir, "litellm.json"), {
      baseUrl: "https://legacy.example",
      endpoints: { company: { baseUrl: "https://company.example" } },
    })
    const registry = loadEndpointRegistry(cwd, logger, {}, agentDir)
    expect(registry.mode).toBe("explicit")
    expect(registry.endpoints).toEqual({})
    expect(warnings.some((message) => message.includes("不能同时"))).toBeTrue()
  })

  test("endpoint id 必须是稳定 ASCII slug，非法 endpoint 不影响合法 sibling", () => {
    const { cwd, agentDir } = makeDirs()
    writeJson(join(agentDir, "litellm.json"), {
      endpoints: {
        "team-a": { baseUrl: "https://a.example" },
        "team_2": { baseUrl: "https://b.example" },
        "Team A": { baseUrl: "https://bad.example" },
        "中文": { baseUrl: "https://bad2.example" },
      },
    })
    const registry = loadEndpointRegistry(cwd, silentLogger, {}, agentDir)
    expect(Object.keys(registry.endpoints)).toEqual(["team-a", "team_2"])
    expect(isEndpointId("team-a")).toBeTrue()
    expect(isEndpointId("team_2")).toBeTrue()
    expect(isEndpointId("Team-A")).toBeFalse()
  })

  test("显式 endpoint 缺少合法 baseUrl 时跳过，env 不补位", () => {
    const { cwd, agentDir } = makeDirs()
    writeJson(join(agentDir, "litellm.json"), {
      endpoints: {
        default: {},
        valid: { baseUrl: "https://valid.example" },
      },
    })
    const registry = loadEndpointRegistry(cwd, silentLogger, { LITELLM_BASE_URL: "https://env.example" }, agentDir)
    expect(Object.keys(registry.endpoints)).toEqual(["valid"])
  })

  test("[VALIDATION-INVALID-PRESERVED] 非法 baseUrl 的 endpoint 保留并标记 invalid", () => {
    const { cwd, agentDir } = makeDirs()
    writeJson(join(agentDir, "litellm.json"), {
      endpoints: {
        valid: { baseUrl: "https://valid.example" },
        broken_scheme: { baseUrl: "ftp://wrong.example" },
        broken_userinfo: { baseUrl: "https://user:pass@x.example" },
      },
    })
    const registry = loadEndpointRegistry(cwd, silentLogger, {}, agentDir)
    expect(Object.keys(registry.endpoints).sort()).toEqual(["broken_scheme", "broken_userinfo", "valid"])
    expect(registry.endpoints.valid?.validation?.kind).toBe("ok")
    expect(registry.endpoints.broken_scheme?.validation?.kind).toBe("invalid")
    expect(registry.endpoints.broken_userinfo?.validation?.kind).toBe("invalid")
    // Runtime never receives the malformed URL; diagnostics keep the reason.
    expect(registry.endpoints.broken_scheme?.baseUrl).toBe("")
    expect(registry.endpoints.broken_scheme?.validation?.kind === "invalid" &&
      registry.endpoints.broken_scheme?.validation.reason).toContain("Base URL")
  })

  test("[VALIDATION-CONSISTENCY] 通过 validateBaseUrl 的 URL 在 registry 中是 ok", () => {
    const { cwd, agentDir } = makeDirs()
    writeJson(join(agentDir, "litellm.json"), {
      endpoints: {
        good: { baseUrl: "http://litellm.example:4000/v1/" },
        trailing: { baseUrl: "https://x.example/" },
      },
    })
    const registry = loadEndpointRegistry(cwd, silentLogger, {}, agentDir)
    expect(registry.endpoints.good?.validation?.kind).toBe("ok")
    expect(registry.endpoints.trailing?.validation?.kind).toBe("ok")
  })

  test("pollInterval 默认 300 且小于 30 被钳制", () => {
    const { cwd, agentDir } = makeDirs()
    expect(loadEndpointRegistry(cwd, silentLogger, {}, agentDir).endpoints.default?.pollInterval)
      .toBe(DEFAULT_POLL_INTERVAL_SECONDS)
    writeJson(join(agentDir, "litellm.json"), { pollInterval: 5 })
    expect(loadEndpointRegistry(cwd, silentLogger, {}, agentDir).endpoints.default?.pollInterval).toBe(30)
  })

  test("格式错误与非法协议安全降级", () => {
    const { cwd, agentDir } = makeDirs()
    const { warnings, logger } = collectingLogger()
    writeFileSync(join(agentDir, "litellm.json"), "not-json{{{", "utf8")
    expect(loadEndpointRegistry(cwd, logger, {}, agentDir).endpoints.default?.baseUrl).toBe("")
    expect(warnings.length).toBeGreaterThan(0)

    writeJson(join(agentDir, "litellm.json"), {
      baseUrl: "https://legacy.example",
      protocolOverrides: { good: "chat", bad: "carrier-pigeon" },
    })
    expect(loadEndpointRegistry(cwd, silentLogger, {}, agentDir).endpoints.default?.protocolOverrides)
      .toEqual({ good: "chat" })
  })
})
