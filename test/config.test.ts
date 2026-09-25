import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { DEFAULT_POLL_INTERVAL_SECONDS, isConfigured, loadConfig } from "../src/extension/config.ts"

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

describe("地址三层来源优先级", () => {
  test("env 优先于项目与全局", () => {
    const { cwd, agentDir } = makeDirs()
    writeJson(join(agentDir, "litellm.json"), { baseUrl: "http://global.example:4000" })
    writeJson(join(cwd, ".pi", "litellm.json"), { baseUrl: "http://project.example:4000" })
    const config = loadConfig(cwd, silentLogger, { LITELLM_BASE_URL: "http://env.example:4000" }, agentDir)
    expect(config.baseUrl).toBe("http://env.example:4000")
  })

  test("项目级优先于全局", () => {
    const { cwd, agentDir } = makeDirs()
    writeJson(join(agentDir, "litellm.json"), { baseUrl: "http://global.example:4000" })
    writeJson(join(cwd, ".pi", "litellm.json"), { baseUrl: "http://project.example:4000" })
    const config = loadConfig(cwd, silentLogger, {}, agentDir)
    expect(config.baseUrl).toBe("http://project.example:4000")
  })

  test("仅全局时使用全局", () => {
    const { cwd, agentDir } = makeDirs()
    writeJson(join(agentDir, "litellm.json"), { baseUrl: "http://global.example:4000" })
    const config = loadConfig(cwd, silentLogger, {}, agentDir)
    expect(config.baseUrl).toBe("http://global.example:4000")
  })

  test("无任何来源时未连接", () => {
    const { cwd, agentDir } = makeDirs()
    const config = loadConfig(cwd, silentLogger, {}, agentDir)
    expect(config.baseUrl).toBe("")
    expect(isConfigured(config)).toBeFalse()
  })
})

describe("配置文件容错", () => {
  test("未知字段被忽略且不影响已知字段", () => {
    const { cwd, agentDir } = makeDirs()
    writeJson(join(cwd, ".pi", "litellm.json"), { baseUrl: "http://litellm.example:4000", unknown: 42 })
    const config = loadConfig(cwd, silentLogger, {}, agentDir)
    expect(config.baseUrl).toBe("http://litellm.example:4000")
    expect("unknown" in config).toBeFalse()
  })

  test("类型非法的字段回退默认值并记录警告", () => {
    const { cwd, agentDir } = makeDirs()
    const { warnings, logger } = collectingLogger()
    mkdirSync(join(cwd, ".pi"), { recursive: true })
    writeFileSync(join(cwd, ".pi", "litellm.json"), "not-json{{{", "utf-8")
    const config = loadConfig(cwd, logger, {}, agentDir)
    expect(config.baseUrl).toBe("")
    expect(config.pollInterval).toBe(DEFAULT_POLL_INTERVAL_SECONDS)
    expect(warnings.length).toBeGreaterThan(0)
  })

  test("JSON 为数组或基础类型时不崩", () => {
    const { cwd, agentDir } = makeDirs()
    writeJson(join(cwd, ".pi", "litellm.json"), [1, 2, 3])
    const config = loadConfig(cwd, silentLogger, {}, agentDir)
    expect(config.baseUrl).toBe("")
  })

  test("baseUrl 为空字符串时视为未提供", () => {
    const { cwd, agentDir } = makeDirs()
    writeJson(join(cwd, ".pi", "litellm.json"), { baseUrl: "   " })
    writeJson(join(agentDir, "litellm.json"), { baseUrl: "http://global.example:4000" })
    const config = loadConfig(cwd, silentLogger, {}, agentDir)
    expect(config.baseUrl).toBe("http://global.example:4000")
  })

  test("env 为空白字符串时回退文件来源", () => {
    const { cwd, agentDir } = makeDirs()
    writeJson(join(cwd, ".pi", "litellm.json"), { baseUrl: "http://project.example:4000" })
    const config = loadConfig(cwd, silentLogger, { LITELLM_BASE_URL: "  " }, agentDir)
    expect(config.baseUrl).toBe("http://project.example:4000")
  })
})

describe("可选配置解析", () => {
  test("pollInterval 默认 300 且小于 30 被钳制", () => {
    const { cwd, agentDir } = makeDirs()
    expect(loadConfig(cwd, silentLogger, {}, agentDir).pollInterval).toBe(DEFAULT_POLL_INTERVAL_SECONDS)

    writeJson(join(cwd, ".pi", "litellm.json"), { pollInterval: 5 })
    const { warnings, logger } = collectingLogger()
    const config = loadConfig(cwd, logger, {}, agentDir)
    expect(config.pollInterval).toBe(30)
    expect(warnings.some((message) => message.includes("pollInterval"))).toBeTrue()
  })

  test("contextTierCap 默认开启，可显式关闭", () => {
    const { cwd, agentDir } = makeDirs()
    expect(loadConfig(cwd, silentLogger, {}, agentDir).contextTierCap).toBeTrue()

    writeJson(join(cwd, ".pi", "litellm.json"), { contextTierCap: false })
    expect(loadConfig(cwd, silentLogger, {}, agentDir).contextTierCap).toBeFalse()
  })

  test("protocolOverrides 合并全局与项目，项目覆盖同名项", () => {
    const { cwd, agentDir } = makeDirs()
    writeJson(join(agentDir, "litellm.json"), {
      protocolOverrides: { "glm-5.3": "chat", "kimi-k3": "responses" },
    })
    writeJson(join(cwd, ".pi", "litellm.json"), { protocolOverrides: { "glm-5.3": "messages" } })
    const config = loadConfig(cwd, silentLogger, {}, agentDir)
    expect(config.protocolOverrides).toEqual({ "glm-5.3": "messages", "kimi-k3": "responses" })
  })

  test("非法协议值被丢弃", () => {
    const { cwd, agentDir } = makeDirs()
    writeJson(join(cwd, ".pi", "litellm.json"), {
      protocolOverrides: { good: "chat", bad: "carrier-pigeon", alsoBad: 42 },
    })
    const config = loadConfig(cwd, silentLogger, {}, agentDir)
    expect(config.protocolOverrides).toEqual({ good: "chat" })
  })
})
