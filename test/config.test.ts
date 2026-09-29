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

  test("配置文件字段非法时回退默认值并记录警告", () => {
    const { cwd, agentDir } = makeDirs()
    const { warnings, logger } = collectingLogger()
    mkdirSync(join(cwd, ".pi"), { recursive: true })
    writeFileSync(join(cwd, ".pi", "litellm.json"), "not-json{{{", "utf-8")
    const config = loadConfig(cwd, logger, {}, agentDir)
    expect(config.baseUrl).toBe("")
    expect(config.pollInterval).toBe(DEFAULT_POLL_INTERVAL_SECONDS)
    expect(warnings.length).toBeGreaterThan(0)
  })

  test("非 http(s) 的 baseUrl 跳过该来源并回退下一来源", () => {
    const { cwd, agentDir } = makeDirs()
    const { warnings, logger } = collectingLogger()
    writeJson(join(cwd, ".pi", "litellm.json"), { baseUrl: "ftp://litellm.example" })
    writeJson(join(agentDir, "litellm.json"), { baseUrl: "http://global.example:4000" })
    const config = loadConfig(cwd, logger, {}, agentDir)
    expect(config.baseUrl).toBe("http://global.example:4000")
    expect(warnings.some((message) => message.includes("非法"))).toBeTrue()
  })

  test("非字符串的 baseUrl 记录警告而非静默丢弃", () => {
    const { cwd, agentDir } = makeDirs()
    const { warnings, logger } = collectingLogger()
    mkdirSync(join(cwd, ".pi"), { recursive: true })
    writeFileSync(join(cwd, ".pi", "litellm.json"), JSON.stringify({ baseUrl: 42 }), "utf-8")
    const config = loadConfig(cwd, logger, {}, agentDir)
    expect(config.baseUrl).toBe("")
    expect(warnings.some((message) => message.includes("baseUrl"))).toBeTrue()
  })

  test("非法的 LITELLM_BASE_URL 跳过 env 并回退配置文件", () => {
    const { cwd, agentDir } = makeDirs()
    const { warnings, logger } = collectingLogger()
    writeJson(join(cwd, ".pi", "litellm.json"), { baseUrl: "http://project.example:4000" })
    const config = loadConfig(cwd, logger, { LITELLM_BASE_URL: "ftp://bad.example" }, agentDir)
    expect(config.baseUrl).toBe("http://project.example:4000")
    expect(warnings.some((message) => message.includes("LITELLM_BASE_URL"))).toBeTrue()
  })

  test("其他已知字段类型非法时记录警告", () => {
    const { cwd, agentDir } = makeDirs()
    const { warnings, logger } = collectingLogger()
    mkdirSync(join(cwd, ".pi"), { recursive: true })
    writeFileSync(
      join(cwd, ".pi", "litellm.json"),
      JSON.stringify({ baseUrl: "http://litellm.example:4000", pollInterval: "soon", contextTierCap: "yes" }),
      "utf-8",
    )
    const config = loadConfig(cwd, logger, {}, agentDir)
    expect(config.baseUrl).toBe("http://litellm.example:4000")
    expect(config.pollInterval).toBe(DEFAULT_POLL_INTERVAL_SECONDS)
    expect(config.contextTierCap).toBeTrue()
    expect(warnings.some((message) => message.includes("pollInterval"))).toBeTrue()
    expect(warnings.some((message) => message.includes("contextTierCap"))).toBeTrue()
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


describe("PR9 显式多 endpoint 配置", () => {
  test("只从全局 endpoints 解析，允许相同 URL，并忽略 env/项目 legacy 来源", () => {
    const { cwd, agentDir } = makeDirs()
    writeJson(join(agentDir, "litellm.json"), {
      pollInterval: 45,
      contextTierCap: false,
      endpoints: {
        company: {
          baseUrl: "http://same.example:4000/v1",
          protocolOverrides: { "model-a": "responses" },
        },
        personal: { baseUrl: "http://same.example:4000" },
      },
    })
    writeJson(join(cwd, ".pi", "litellm.json"), {
      baseUrl: "http://project.example:4000",
      pollInterval: 99,
    })
    const { warnings, logger } = collectingLogger()
    const config = loadConfig(cwd, logger, { LITELLM_BASE_URL: "http://env.example:4000" }, agentDir)

    expect(config.mode).toBe("multi")
    expect(config.baseUrl).toBe("")
    expect(config.pollInterval).toBe(45)
    expect(config.contextTierCap).toBeFalse()
    expect(config.endpoints).toEqual([
      {
        id: "company",
        baseUrl: "http://same.example:4000/v1",
        protocolOverrides: { "model-a": "responses" },
      },
      {
        id: "personal",
        baseUrl: "http://same.example:4000",
        protocolOverrides: {},
      },
    ])
    expect(isConfigured(config)).toBeTrue()
    expect(warnings.some((message) => message.includes("LITELLM_BASE_URL"))).toBeTrue()
    expect(warnings.some((message) => message.includes("项目级"))).toBeTrue()
  })

  test("endpoints 与顶层 legacy endpoint 字段混用时 fail closed", () => {
    const { cwd, agentDir } = makeDirs()
    writeJson(join(agentDir, "litellm.json"), {
      baseUrl: "http://legacy.example:4000",
      endpoints: { company: { baseUrl: "http://company.example:4000" } },
    })
    const { warnings, logger } = collectingLogger()
    const config = loadConfig(cwd, logger, {}, agentDir)

    expect(config.mode).toBe("multi")
    expect(config.endpoints).toEqual([])
    expect(isConfigured(config)).toBeFalse()
    expect(config.configIssues).toContain("显式 endpoints 不能与顶层 baseUrl/protocolOverrides 混用")
    expect(warnings.some((message) => message.includes("身份混用"))).toBeTrue()
  })

  test("endpoint id 采用共享 ASCII slug 契约，非法项只影响自己", () => {
    const { cwd, agentDir } = makeDirs()
    writeJson(join(agentDir, "litellm.json"), {
      endpoints: {
        "team-1": { baseUrl: "http://valid.example:4000" },
        Team: { baseUrl: "http://invalid.example:4000" },
        "团队": { baseUrl: "http://invalid2.example:4000" },
      },
    })
    const { warnings, logger } = collectingLogger()
    const config = loadConfig(cwd, logger, {}, agentDir)
    expect(config.endpoints?.map((endpoint) => endpoint.id)).toEqual(["team-1"])
    expect(warnings.filter((message) => message.includes("endpoint id")).length).toBe(2)
  })

  test("项目级 endpoints 不会开启 multi 模式", () => {
    const { cwd, agentDir } = makeDirs()
    writeJson(join(cwd, ".pi", "litellm.json"), {
      endpoints: { project: { baseUrl: "http://project.example:4000" } },
    })
    const { warnings, logger } = collectingLogger()
    const config = loadConfig(cwd, logger, {}, agentDir)
    expect(config.mode).toBe("legacy")
    expect(config.baseUrl).toBe("")
    expect(warnings.some((message) => message.includes("只允许配置在全局"))).toBeTrue()
  })
})
