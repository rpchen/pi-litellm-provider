/**
 * Poll-follow integration test: a catalog change on the (mock) LiteLLM side is reflected
 * by the host after one poll tick, and removals disappear.
 *
 * Drives the real refreshProviderModels + host ModelRuntime through a local mock LiteLLM,
 * with a 30s poll interval shortened for the test via a direct refresh call.
 */
import { describe, expect, test } from "bun:test"
import { refreshProviderModels } from "../src/extension/discovery.ts"
import { DEFAULT_POLL_INTERVAL_SECONDS, type ExtensionConfig } from "../src/extension/config.ts"
import type { ProviderModelConfigLike, RefreshModelsContextLike } from "../src/extension/types.ts"

function config(baseUrl: string): ExtensionConfig {
  return {
    baseUrl,
    pollInterval: DEFAULT_POLL_INTERVAL_SECONDS,
    contextTierCap: true,
    protocolOverrides: {},
    globalConfigPath: "unused",
    projectConfigPath: "unused",
  }
}

function deployment(name: string) {
  return {
    model_name: name,
    litellm_params: { model: `openai/${name}` },
    // Fully declared LiteLLM-only model so the poll-follow path exercises
    // registration churn rather than publication blocking.
    model_info: {
      mode: "chat",
      max_input_tokens: 10000,
      max_output_tokens: 1000,
      supports_function_calling: false,
      supports_reasoning: false,
      supports_vision: false,
      supports_audio_output: false,
    },
  }
}

describe("轮询跟随 LiteLLM 端变更", () => {
  test("新增模型出现、删除模型消失", async () => {
    let deployments = [deployment("model-a"), deployment("model-b")]
    const server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ data: deployments })
      },
    })
    const baseUrl = `http://127.0.0.1:${server.port}`

    let stored: ProviderModelConfigLike[] | undefined
    const context: RefreshModelsContextLike = {
      allowNetwork: true,
      signal: new AbortController().signal,
      credential: { type: "api_key", key: "sk-test" },
      get stored() {
        return stored ? { models: stored } : undefined
      },
      publish: async (publication) => {
        const persist = (publication as { persist?: { models: ProviderModelConfigLike[] } }).persist
        if (persist) stored = persist.models
        return true
      },
    }
    // Offline: inject the models.dev catalog so the test never depends on the real
    // 5MB api.json (which timed out CI without this).
    const deps = {
      logger: { warn: () => {}, error: () => {} },
      loadModelsDevCatalog: async () => ({}),
    }

    try {
      const first = await refreshProviderModels(config(baseUrl), context, deps)
      expect(first.map((model) => model.id)).toEqual(["model-a", "model-b"])

      // Admin adds a model and removes another.
      deployments = [deployment("model-b"), deployment("model-c")]
      const second = await refreshProviderModels(config(baseUrl), context, deps)
      expect(second.map((model) => model.id)).toEqual(["model-b", "model-c"])
      expect(stored?.map((model) => model.id)).toEqual(["model-b", "model-c"])
    } finally {
      server.stop(true)
    }
  })
})
