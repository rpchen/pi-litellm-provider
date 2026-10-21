import { expect, test } from "bun:test"
import { buildProviderConfig } from "../src/extension/index.ts"
import { createProviderDiagnosticsState } from "../src/extension/diagnostics.ts"
import type { ExtensionConfig } from "../src/extension/config.ts"
import type { RefreshModelsContextLike } from "../src/extension/types.ts"
import blockedInfo from "./fixtures/blocked-deployments/model-info.json" with { type: "json" }
import blockedCatalog from "./fixtures/blocked-deployments/modelsdev-catalog.json" with { type: "json" }
import visibleModels from "./fixtures/blocked-deployments/visible-models.json" with { type: "json" }

// [BLOCKED-HOST-REFRESH] Core → Pi refreshModels → persistence and command diagnostics state.
test("company refresh withdraws paused models despite unchanged raw model names", async () => {
  const activeInfo = { data: blockedInfo.data.map(row => ({ ...row, model_info: { ...row.model_info, blocked: false } })) }
  let live: unknown = activeInfo
  let persisted: unknown
  const diagnostics = createProviderDiagnosticsState()
  const config: ExtensionConfig = {
    endpointId: "company", baseUrl: "http://litellm.example:4000", pollInterval: 3600,
    contextTierCap: false, protocolOverrides: {}, globalConfigPath: "unused", projectConfigPath: "unused",
  }
  const provider = buildProviderConfig(() => config, {
    fetchImpl: async () => new Response(JSON.stringify(live), { status: 200 }),
    loadModelsDevCatalog: async () => blockedCatalog,
    logger: { warn() {}, error() {} },
  }, diagnostics, "company")
  const context: RefreshModelsContextLike = {
    allowNetwork: true, force: true, signal: new AbortController().signal, credential: { key: "sk-test" },
    publish: async publication => { persisted = publication.persist; publication.update?.(); return true },
  }
  expect(provider.refreshModels).toBeDefined()
  expect(await provider.refreshModels!(context)).toHaveLength(20)
  expect(diagnostics.current.modelCount).toBe(20)
  expect(new Set(activeInfo.data.map(row => row.model_name))).toEqual(new Set(blockedInfo.data.map(row => row.model_name)))
  live = blockedInfo
  const models = await provider.refreshModels!(context)
  const expected = Array.from({ length: 13 }, (_, i) => `chat-model-${String(i + 1).padStart(2, "0")}`)
  expect(models.map(model => model.id).sort()).toEqual(expected)
  expect(diagnostics.current.modelCount).toBe(13)
  expect(diagnostics.current.models?.map(model => model.id).sort()).toEqual(expected)
  expect(persisted).toMatchObject({ models })
  const visible = new Set(visibleModels.data.map(model => model.id))
  expect(models.every(model => visible.has(model.id))).toBe(true)
  expect((await provider.refreshModels!(context)).map(model => model.id).sort()).toEqual(expected)
})
