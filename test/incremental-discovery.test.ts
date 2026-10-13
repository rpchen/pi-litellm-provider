import { describe, expect, test } from "bun:test"
import { officialCatalog } from "./fixtures/catalog.ts"
import { createProviderDiagnosticsState } from "../src/extension/diagnostics.ts"
import { createProviderRefreshCoordinator, refreshProviderModels } from "../src/extension/discovery.ts"
import type { ExtensionConfig } from "../src/extension/config.ts"
import type { RefreshModelsContextLike } from "../src/extension/types.ts"
import type { FetchLike } from "../src/net/fetch.ts"

const ROOT = "http://litellm.example:4000"

function response(names: readonly string[], route = "openai/"): unknown {
  return {
    data: names.map((model_name) => ({
      model_name,
      litellm_params: { model: `${route}${model_name}` },
      model_info: {
        mode: "chat",
        max_input_tokens: 100000,
        max_output_tokens: 10000,
        supports_function_calling: true,
        supports_reasoning: false,
        supports_vision: false,
        supports_pdf_input: false,
        supports_audio_input: false,
        supports_video_input: false,
        supports_audio_output: false,
      },
    })),
  }
}

function catalog(names: readonly string[]): unknown {
  return officialCatalog(Object.fromEntries(names.map((name) => [
    `openai/${name}`,
    {
      limit: { context: 100000, output: 10000 },
      tool_call: true,
      reasoning: false,
      modalities: { input: ["text"], output: ["text"] },
    },
  ])))
}

function config(): ExtensionConfig {
  return {
    baseUrl: ROOT,
    pollInterval: 3600,
    contextTierCap: false,
    protocolOverrides: {},
    globalConfigPath: "unused",
    projectConfigPath: "unused",
  }
}

function context(force = true): RefreshModelsContextLike {
  return {
    allowNetwork: true,
    force,
    signal: new AbortController().signal,
    credential: { key: "sk-test" },
    publish: async () => true,
  }
}

describe("incremental Pi discovery", () => {
  test("uses model_name identity and demand-driven catalog refresh", async () => {
    let live: unknown = response(["model-a"])
    let localCatalog: unknown = catalog(["model-a"])
    let latestCatalog: unknown = localCatalog
    let fetches = 0
    let catalogRequests = 0
    let forceCatalogRequests = 0
    let forceCatalogFailure = false
    const fetchImpl: FetchLike = async () => {
      fetches += 1
      return new Response(JSON.stringify(live), { status: 200 })
    }
    const deps = {
      fetchImpl,
      loadModelsDevCatalog: async (
        _signal?: AbortSignal,
        request: { readonly cachedOnly?: boolean; readonly forceRefresh?: boolean } = {},
      ) => {
        catalogRequests += 1
        if (request.forceRefresh) {
          forceCatalogRequests += 1
          if (forceCatalogFailure) throw Object.assign(new Error("models.dev offline"), { code: "ECONNREFUSED" })
          return latestCatalog
        }
        return localCatalog
      },
      logger: { warn() {}, error() {} },
    }
    const coordinator = createProviderRefreshCoordinator()
    const diagnostics = createProviderDiagnosticsState()
    const refresh = () => refreshProviderModels(config(), context(), deps, coordinator, diagnostics)

    expect((await refresh()).map((model) => model.id)).toEqual(["model-a"])
    expect(fetches).toBe(1)
    expect(catalogRequests).toBe(1)
    expect(forceCatalogRequests).toBe(0)

    // Same identity, including an internal route change: no metadata work.
    live = response(["model-a"], "private/")
    expect((await refresh()).map((model) => model.id)).toEqual(["model-a"])
    expect(catalogRequests).toBe(1)

    // New model with a local catalog hit: process only the addition.
    localCatalog = catalog(["model-a", "model-b"])
    live = response(["model-a", "model-b"])
    expect((await refresh()).map((model) => model.id)).toEqual(["model-a", "model-b"])
    expect(forceCatalogRequests).toBe(0)

    // New model absent locally: demand the latest catalog once.
    localCatalog = catalog(["model-a", "model-b"])
    latestCatalog = catalog(["model-a", "model-b", "model-c"])
    live = response(["model-a", "model-b", "model-c"])
    expect((await refresh()).map((model) => model.id)).toEqual(["model-a", "model-b", "model-c"])
    expect(forceCatalogRequests).toBe(1)

    // Deletion and another route-only change do not access models.dev.
    live = response(["model-a", "model-b"], "private/")
    expect((await refresh()).map((model) => model.id)).toEqual(["model-a", "model-b"])
    expect(catalogRequests).toBe(4)
    expect(forceCatalogRequests).toBe(1)

    // A newly added model withheld by a temporary catalog outage is reprocessed
    // on the next unchanged model-set refresh; already registered models remain.
    forceCatalogFailure = true
    live = response(["model-a", "model-b", "model-d"])
    expect((await refresh()).map((model) => model.id)).toEqual(["model-a", "model-b"])
    expect(diagnostics.current.publication?.withheld.map((entry) => entry.id)).toEqual(["model-d"])
    expect(diagnostics.current.publication?.failureKind).toBe("unreachable")

    forceCatalogFailure = false
    latestCatalog = catalog(["model-a", "model-b", "model-d"])
    expect((await refresh()).map((model) => model.id)).toEqual(["model-a", "model-b", "model-d"])
    expect(diagnostics.current.publication?.withheld).toEqual([])
    expect(forceCatalogRequests).toBe(3)

    // A complete catalog with a stable unmatched identity is not a temporary
    // metadata failure and does not trigger another catalog request next round.
    localCatalog = catalog(["model-a", "model-b", "model-d"])
    latestCatalog = catalog(["model-a", "model-b", "model-d"])
    live = response(["model-a", "model-b", "model-d", "stable-unmatched"])
    expect((await refresh()).map((model) => model.id)).toEqual(["model-a", "model-b", "model-d"])
    const catalogRequestsAfterStableMiss = catalogRequests
    expect(diagnostics.current.publication?.withheld[0]?.status).toBe("unmatched")
    latestCatalog = catalog(["model-a", "model-b", "model-d", "stable-unmatched"])
    expect((await refresh()).map((model) => model.id)).toEqual(["model-a", "model-b", "model-d"])
    expect(catalogRequests).toBe(catalogRequestsAfterStableMiss)
  })
})
