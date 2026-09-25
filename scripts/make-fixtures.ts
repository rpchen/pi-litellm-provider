/**
 * Fixture generator for LiteLLM /v1/model/info response samples.
 *
 * Reads a raw response captured from a real LiteLLM deployment (.tmp/raw-model-info.json,
 * gitignored), keeps only the fields the discovery core consumes, replaces private
 * addresses and identifiers with placeholders, then appends hand-written synthetic
 * deployments covering edge cases the live sample does not contain.
 *
 * Credentials and raw responses never enter the repository: only the sanitized output
 * (test/fixtures/litellm-model-info.json) is committed.
 *
 * Usage: bun scripts/make-fixtures.ts [input.json] [output.json]
 */
import { mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"

/** model_info keys copied verbatim into fixtures. */
const DIRECT_MODEL_INFO_KEYS = new Set([
  "mode",
  "base_model",
  "litellm_provider",
  "models_dev_provider",
  "supported_endpoints",
  "tiered_pricing",
])

/** model_info key name patterns copied verbatim (capability / limit / cost fields). */
const MODEL_INFO_KEY_PATTERNS = [/^max_/, /^supports_/, /_cost_/]

/**
 * Hosts that must never appear in fixtures. Any http(s) URL found in a retained
 * string value is rewritten to a placeholder regardless of host, so private
 * endpoints cannot leak through cost or limit fields.
 */
const PLACEHOLDER_URL = "http://litellm.example:4000"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function keepModelInfoKey(key: string): boolean {
  return DIRECT_MODEL_INFO_KEYS.has(key) || MODEL_INFO_KEY_PATTERNS.some((pattern) => pattern.test(key))
}

/** Rewrite any embedded http(s) URL to the placeholder; drop other private-looking strings. */
function scrubString(value: string): string {
  if (/^https?:\/\//i.test(value)) return PLACEHOLDER_URL
  return value
}

function cloneJsonValue(value: unknown): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value
  if (typeof value === "string") return scrubString(value)
  if (Array.isArray(value)) return value.map(cloneJsonValue)
  if (!isRecord(value)) return undefined

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [key, cloneJsonValue(item)] as const)
      .filter((entry): entry is readonly [string, unknown] => entry[1] !== undefined),
  )
}

/** Keep only whitelisted deployment fields; deployments without model_name are dropped. */
export function sanitizeModelInfoFixture(input: unknown): { data: Record<string, unknown>[] } {
  const deployments = isRecord(input) && Array.isArray(input.data) ? input.data : []
  const data: Record<string, unknown>[] = []

  for (const item of deployments) {
    if (!isRecord(item) || typeof item.model_name !== "string") continue

    const output: Record<string, unknown> = { model_name: item.model_name }
    if (isRecord(item.litellm_params)) {
      const litellmParams: Record<string, unknown> = {}
      for (const key of ["model", "custom_llm_provider"] as const) {
        if (typeof item.litellm_params[key] === "string") {
          litellmParams[key] = scrubString(item.litellm_params[key])
        }
      }
      if (Object.keys(litellmParams).length > 0) output.litellm_params = litellmParams
    }

    if (isRecord(item.model_info)) {
      const modelInfo = Object.fromEntries(
        Object.entries(item.model_info)
          .filter(([key]) => keepModelInfoKey(key))
          .map(([key, value]) => [key, cloneJsonValue(value)] as const)
          .filter((entry): entry is readonly [string, unknown] => entry[1] !== undefined),
      )
      if (Object.keys(modelInfo).length > 0) output.model_info = modelInfo
    }

    data.push(output)
  }

  return { data }
}

/**
 * Synthetic deployments for spec scenarios the live sample cannot guarantee:
 * Anthropic upstreams (Messages routing), supported_endpoints declarations,
 * tiered_pricing pricing ladders, name-based image exclusions, multi-deployment
 * divergence, invalid field types, and a deployment missing model_name.
 */
export function syntheticDeployments(): Record<string, unknown>[] {
  return [
    {
      model_name: "claude-db",
      litellm_params: { model: "claude-sonnet-4-5", custom_llm_provider: "anthropic" },
      model_info: {
        mode: "chat",
        base_model: "claude-sonnet-4-5",
        max_input_tokens: 200000,
        max_output_tokens: 64000,
        supports_function_calling: true,
        supports_vision: true,
      },
    },
    {
      model_name: "claude-bedrock",
      litellm_params: { model: "bedrock/anthropic.claude-sonnet-4-5" },
      model_info: {
        mode: "chat",
        base_model: "claude-sonnet-4-5",
        litellm_provider: "bedrock",
        max_input_tokens: 200000,
        max_output_tokens: 64000,
      },
    },
    {
      model_name: "multi-endpoint-model",
      litellm_params: { model: "openai/multi-endpoint-model" },
      model_info: {
        mode: "chat",
        supported_endpoints: ["/v1/chat/completions", "/v1/batch", "/v1/responses"],
        max_input_tokens: 128000,
        max_output_tokens: 16000,
      },
    },
    {
      model_name: "responses-only-model",
      litellm_params: { model: "openai/responses-only-model" },
      model_info: {
        mode: "chat",
        supported_endpoints: ["/v1/responses"],
        max_input_tokens: 128000,
        max_output_tokens: 16000,
      },
    },
    {
      model_name: "tiered-pricing-model",
      litellm_params: { model: "openai/tiered-pricing-model" },
      model_info: {
        mode: "chat",
        max_input_tokens: 1000000,
        max_output_tokens: 64000,
        input_cost_per_token: 1e-6,
        output_cost_per_token: 4e-6,
        tiered_pricing: [
          { range: [0, 256000], input_cost_per_token: 1e-6, output_cost_per_token: 4e-6 },
          { range: [256000, 1000000], input_cost_per_token: 2e-6, output_cost_per_token: 8e-6 },
        ],
      },
    },
    {
      model_name: "qwen3.7-plus",
      litellm_params: { model: "openai/qwen3.7-plus" },
      model_info: {
        max_input_tokens: 1000000,
        max_output_tokens: 64000,
        supports_function_calling: true,
      },
    },
    {
      model_name: "dall-e-3",
      litellm_params: { model: "openai/dall-e-3" },
      model_info: { max_input_tokens: 4000 },
    },
    {
      model_name: "shared-route",
      litellm_params: { model: "anthropic/claude-haiku-4-5" },
      model_info: {
        mode: "chat",
        max_input_tokens: 200000,
        max_output_tokens: 32000,
      },
    },
    {
      model_name: "shared-route",
      litellm_params: { model: "openai/gpt-5.5" },
      model_info: {
        mode: "responses",
        max_input_tokens: 400000,
        max_output_tokens: 128000,
      },
    },
    {
      model_name: "invalid-fields",
      litellm_params: { model: "openai/invalid-fields" },
      model_info: {
        mode: "chat",
        max_input_tokens: "abc",
        max_output_tokens: null,
        supports_function_calling: "yes",
        supports_vision: 1,
        input_cost_per_token: "secret",
      },
    },
    {
      model_name: "glm-fallback",
      litellm_params: { model: "openai/glm-fallback" },
      model_info: {
        mode: "chat",
        models_dev_provider: "zhipuai",
        max_input_tokens: 128000,
        max_output_tokens: 16000,
      },
    },
    {
      // Deployment missing model_name: discovery must skip it without failing the pass.
      litellm_params: { model: "openai/missing-name" },
      model_info: {
        mode: "chat",
        max_input_tokens: 128000,
        max_output_tokens: 16000,
      },
    },
  ]
}

async function main(): Promise<void> {
  const [, , inputName = ".tmp/raw-model-info.json", outputName = "test/fixtures/litellm-model-info.json"] =
    process.argv
  const inputPath = resolve(inputName)
  const outputPath = resolve(outputName)

  const input: unknown = JSON.parse(await Bun.file(inputPath).text())
  const real = sanitizeModelInfoFixture(input).data
  const synthetic = syntheticDeployments()
  // Real deployments whose names collide with synthetic scenarios are replaced by
  // the synthetic versions so edge-case assertions stay deterministic.
  const syntheticNames = new Set(synthetic.map((entry) => entry.model_name).filter((name) => name !== undefined))
  const kept = real.filter((entry) => !syntheticNames.has(entry.model_name as string))
  // Synthetic entries are appended wholesale: they include the missing-model_name case,
  // which sanitizeModelInfoFixture intentionally drops from raw input.
  const data = [...kept, ...synthetic]

  const fixture = { data }
  const serialized = `${JSON.stringify(fixture, null, 2)}\n`

  // Fail closed: refuse to write a fixture that still carries private data.
  const forbidden = ["api_base", "litellm_credential_name", '"tags"', "access_via_team_ids", "access_groups", "api_key"]
  for (const key of forbidden) {
    if (serialized.includes(key)) throw new Error(`sanitization leaked forbidden field: ${key}`)
  }
  if (/sk-[A-Za-z0-9_-]{8,}/.test(serialized)) throw new Error("sanitization leaked a secret-looking string")
  if (/https?:\/\/(?!litellm\.example:4000)/.test(serialized)) {
    throw new Error("sanitization leaked a non-placeholder URL")
  }

  await mkdir(dirname(outputPath), { recursive: true })
  await Bun.write(outputPath, serialized)
  console.log(`wrote ${data.length} deployments (${kept.length} sanitized + ${synthetic.length} synthetic) to ${outputPath}`)
}

if (import.meta.main) await main()
