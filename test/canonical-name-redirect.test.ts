import { expect, test } from "bun:test"
import observed from "./fixtures/canonical-name-redirect.json" with { type: "json" }
import { buildPublicationResult, createDiscoverySnapshot, endpointFingerprint } from "../src/core/index.ts"
import { refreshProviderModels, createProviderRefreshCoordinator } from "../src/extension/discovery.ts"
import { toProviderModels } from "../src/extension/map.ts"
import { createProviderDiagnosticsState, formatProviderDiagnostics } from "../src/extension/diagnostics.ts"
import type { RefreshModelsContextLike } from "../src/extension/types.ts"

test("[REDIRECT-HOST] fresh discovery replaces oversized persisted output and a new Pi instance restores the corrected value", async () => {
  const config = { baseUrl: "http://litellm.example:4000", contextTierCap: false, protocolOverrides: {}, pollInterval: 300, globalConfigPath: "unused", projectConfigPath: "unused" }
  const key = "sk-test"
  const result = buildPublicationResult(observed.discovery, observed.catalog, config)
  const spec = result.publishable[0]!.spec
  const endpoint = endpointFingerprint({ baseUrl: config.baseUrl, credentialKey: key, buildOptions: config })
  const oldSpec = { ...spec, limit: { ...spec.limit, output: 943718 } }
  const old = { models: toProviderModels([oldSpec], config.baseUrl), snapshot: createDiscoverySnapshot(endpoint, [oldSpec]) }
  const diagnostics = createProviderDiagnosticsState()
  const coordinator = createProviderRefreshCoordinator()
  const deps = {
    fetchImpl: async () => new Response(JSON.stringify(observed.discovery)),
    loadModelsDevCatalog: async () => observed.catalog,
    logger: { warn() {}, error() {} },
  }
  const restored = await refreshProviderModels(config, { allowNetwork: false, credential: { key }, stored: old }, deps, coordinator, diagnostics)
  expect(restored[0]!.maxTokens).toBe(943718)
  let stored: RefreshModelsContextLike["stored"]
  const models = await refreshProviderModels(config, { allowNetwork: true, force: true, credential: { key }, stored: old,
    publish: async publication => { stored = publication.persist as RefreshModelsContextLike["stored"]; return true },
  }, deps, coordinator, diagnostics)
  expect(models[0]!.id).toBe("deepseek-v4.1-flash")
  expect(models[0]!.contextWindow).toBe(1048576)
  expect(models[0]!.maxTokens).toBe(393216)
  expect(formatProviderDiagnostics(diagnostics)).toContain("来源 deepseek")
  expect(stored).toBeDefined()
  const next = await refreshProviderModels(config, { allowNetwork: false, credential: { key }, stored }, {
    fetchImpl: async () => { throw new Error("new-instance restore must not fetch") },
    logger: { warn() {}, error() {} },
  }, createProviderRefreshCoordinator(), createProviderDiagnosticsState())
  expect(next[0]!.maxTokens).toBe(393216)
})
