import { describe, expect, test } from "bun:test"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { createAuditReport } from "../src/extension/audit.ts"
import { auditDirectory, writeAuditFile } from "../src/extension/audit-file.ts"
import { DEFAULT_POLL_INTERVAL_SECONDS, type ExtensionConfig } from "../src/extension/config.ts"
import { formatProviderDiagnostics, createProviderDiagnosticsState } from "../src/extension/diagnostics.ts"
import piLitellmProvider from "../src/extension/index.ts"
import { getRuntimeIdentity, resetRuntimeIdentityForTests, setRuntimeIdentityForTests } from "../src/extension/runtime-identity.ts"
import type { ProviderConfigLike, RefreshModelsContextLike } from "../src/extension/types.ts"

const CORE_SHA = "8e155e0efe90f1e9e7c8e973239c206a97011477"
const DIGEST = `sha256:${"c".repeat(64)}`
const FIXTURE_IDENTITY = { pluginVersion: "0.5.0", artifactDigest: DIGEST, coreCommit: CORE_SHA }

function config(overrides: Partial<ExtensionConfig> = {}): ExtensionConfig {
  return {
    baseUrl: "http://litellm.example:4000",
    pollInterval: DEFAULT_POLL_INTERVAL_SECONDS,
    contextTierCap: true,
    protocolOverrides: {},
    globalConfigPath: "unused",
    projectConfigPath: "unused",
    ...overrides,
  }
}

const body = {
  data: [{
    model_name: "gpt-audit",
    litellm_params: { model: "openai/gpt-audit", api_key: "sk-audit-secret", api_base: "https://private.example" },
    model_info: {
      supported_endpoints: ["/v1/responses"],
      max_input_tokens: 100000,
      max_output_tokens: 10000,
    },
  }],
}

const catalog = {
  openai: {
    models: {
      "gpt-audit": {
        id: "gpt-audit",
        release_date: "2026-05-01",
        modalities: { input: ["text"], output: ["text"] },
        limit: { context: 100000, output: 10000 },
        tool_call: false,
        reasoning: false,
      },
    },
  },
}

function fakePi() {
  const registrations: Array<{ name: string; config: ProviderConfigLike }> = []
  const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>()
  const api = {
    registerProvider(name: string, value: ProviderConfigLike) {
      registrations.push({ name, config: value })
    },
    unregisterProvider() {},
    registerCommand(name: string, value: { handler: (args: string, ctx: unknown) => Promise<void> }) {
      commands.set(name, value)
    },
    on() { return () => {} },
  } as unknown as ExtensionAPI
  return { api, registrations, commands }
}

function refreshContext(overrides: Partial<RefreshModelsContextLike> = {}): RefreshModelsContextLike {
  return {
    allowNetwork: true,
    signal: new AbortController().signal,
    credential: { type: "api_key", key: "sk-audit-secret" },
    publish: async () => true,
    ...overrides,
  }
}

describe("Pi audit export [AUDIT-FULL] [AUDIT-SAFE]", () => {
  test("report carries the full canonical identity and allowlisted models", async () => {
    resetRuntimeIdentityForTests()
    setRuntimeIdentityForTests(FIXTURE_IDENTITY)
    try {
      const h = fakePi()
      const agentDir = mkdtempSync(path.join(os.tmpdir(), "pi-audit-e2e-"))
      try {
        piLitellmProvider(h.api, {
          config: config(),
          agentDir,
          deps: {
            fetchImpl: async () => new Response(JSON.stringify(body), { status: 200 }),
            loadModelsDevCatalog: async () => catalog,
            logger: { warn: () => {}, error: () => {} },
          },
        })
        const provider = h.registrations[0]!.config
        const models = await provider.refreshModels!(refreshContext())
        expect(models.map((model) => model.id)).toEqual(["gpt-audit"])

        const auditCommand = h.commands.get("litellm-audit-export")
        expect(auditCommand).toBeDefined()
        const notifications: Array<{ message: string; level: string }> = []
        await auditCommand!.handler("", { ui: { notify: (message: string, level: string) => { notifications.push({ message, level }) } } })
        expect(notifications).toHaveLength(1)
        expect(notifications[0]!.level).toBe("info")
        expect(notifications[0]!.message).toContain("LiteLLM 审查报告已导出")

        const dir = auditDirectory(agentDir)
        const files = readdirSync(dir).filter((name) => name.startsWith("litellm-audit-") && name.endsWith(".json"))
        expect(files.length).toBe(1)
        const report = JSON.parse(readFileSync(path.join(dir, files[0]!), "utf8")) as {
          runtimeIdentity: { pluginVersion: string; artifactDigest: string; coreCommit: string }
          endpoints: Array<{ id: string; models: Array<Record<string, unknown>> }>
        }
        expect(report.runtimeIdentity).toEqual(FIXTURE_IDENTITY)
        expect(report.runtimeIdentity.artifactDigest.startsWith("sha256:")).toBeTrue()
        expect(report.runtimeIdentity.coreCommit).toHaveLength(40)
        expect(report.endpoints[0]!.models).toHaveLength(1)
        const serialized = JSON.stringify(report)
        expect(serialized).toContain("gpt-audit")
        for (const forbidden of ["sk-audit-secret", "private.example", "api_base", "baseUrl", "api_key"]) {
          expect(serialized).not.toContain(forbidden)
        }
        // Diagnostics use the same canonical identity. [CANONICAL-SINGLE] [DIAG-SHORT]
        const diagnosticsCommand = h.commands.get("litellm-diagnostics")
        const diagnosticsNotifications: Array<{ message: string }> = []
        await diagnosticsCommand!.handler("default", { ui: { notify: (message: string) => { diagnosticsNotifications.push({ message }) } } })
        expect(diagnosticsNotifications[0]!.message).toContain("Runtime Identity")
        expect(diagnosticsNotifications[0]!.message).toContain("Plugin Version   0.5.0")
        expect(diagnosticsNotifications[0]!.message).toContain("Artifact         cccccccc")
        expect(diagnosticsNotifications[0]!.message).toContain("Core Commit      8e155e0e")
      } finally {
        rmSync(agentDir, { recursive: true, force: true })
      }
    } finally {
      resetRuntimeIdentityForTests()
    }
  })

  test("createAuditReport excludes baseUrl but keeps allowlisted model fields", () => {
    resetRuntimeIdentityForTests()
    setRuntimeIdentityForTests(FIXTURE_IDENTITY)
    try {
      const report = createAuditReport([{
        id: "default",
        providerId: "litellm",
        status: "ready",
        models: [{
          id: "m",
          name: "M",
          api: "openai-responses",
          baseUrl: "http://litellm.example:4000/v1",
          reasoning: true,
          thinkingLevelMap: { high: "high" },
          input: ["text"],
          cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 1000,
          maxTokens: 100,
        }],
      }]) as { endpoints: Array<{ models: Array<Record<string, unknown>> }> }
      const serialized = JSON.stringify(report)
      expect(serialized).not.toContain("litellm.example")
      expect(serialized).not.toContain("baseUrl")
      expect(report.endpoints[0]!.models[0]).toMatchObject({ id: "m", api: "openai-responses", contextWindow: 1000 })
    } finally {
      resetRuntimeIdentityForTests()
    }
  })

  test("audit file write is atomic and reports an absolute path", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "pi-audit-file-"))
    try {
      const file = writeAuditFile({ hello: "world" }, dir)
      expect(path.isAbsolute(file)).toBeTrue()
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ hello: "world" })
      expect(getRuntimeIdentity()).toBeDefined()
      void formatProviderDiagnostics
      void createProviderDiagnosticsState
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("Pi startup log [STARTUP-LOG] [CANONICAL-SINGLE]", () => {
  test("factory logs the same canonical identity once", () => {
    resetRuntimeIdentityForTests()
    setRuntimeIdentityForTests(FIXTURE_IDENTITY)
    try {
      const lines: string[] = []
      const h = fakePi()
      piLitellmProvider(h.api, {
        config: config(),
        deps: { logger: { warn: () => {}, error: () => {} } },
        logger: { info: (line: string) => { lines.push(line) }, log: (line: string) => { lines.push(line) } },
      })
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain("plugin=0.5.0")
      expect(lines[0]).toContain("artifact=cccccccc")
      expect(lines[0]).toContain("core=8e155e0e")
      expect(lines[0]).not.toContain("sk-")
    } finally {
      resetRuntimeIdentityForTests()
    }
  })
})
