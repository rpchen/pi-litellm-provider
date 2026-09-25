/**
 * Messages-protocol endpoint shape (design D3).
 *
 * The live LiteLLM deployment has no Claude/Messages model, so this pins the URL and
 * auth-header contract against a local mock server using pi-ai's real
 * anthropic-messages adapter: baseUrl = `{root}` (no `/v1`) must produce
 * `{root}/v1/messages` with the `x-api-key` header.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { stream } from "@earendil-works/pi-ai/api/anthropic-messages"
import type { Model } from "@earendil-works/pi-ai"

/** Drain a stream without depending on its concrete event type. */
async function drain(value: unknown): Promise<void> {
  for await (const _event of value as AsyncIterable<unknown>) {
    void _event
  }
}

interface CapturedRequest {
  path: string
  headers: Record<string, string>
}

const captured: CapturedRequest[] = []
let server: ReturnType<typeof Bun.serve>

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      captured.push({
        path: new URL(request.url).pathname,
        headers: Object.fromEntries(request.headers.entries()),
      })
      return new Response(
        JSON.stringify({
          id: "msg_mock",
          type: "message",
          role: "assistant",
          model: "claude-mock",
          content: [{ type: "text", text: "hi" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    },
  })
})

afterAll(() => {
  server.stop(true)
})

function model(baseUrl: string): Model<"anthropic-messages"> {
  return {
    id: "claude-mock",
    name: "claude-mock",
    api: "anthropic-messages",
    provider: "litellm",
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 4096,
  }
}

describe("Messages 端点路径", () => {
  test("根地址（不带 /v1）产生 /v1/messages 且用 x-api-key", async () => {
    captured.length = 0
    const root = `http://127.0.0.1:${server.port}`
    const messageStream = stream(
      model(root),
      { messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] } as never,
      { apiKey: "sk-mock-key" } as never,
    )
    await drain(messageStream)

    expect(captured).toHaveLength(1)
    expect(captured[0]!.path).toBe("/v1/messages")
    expect(captured[0]!.headers["x-api-key"]).toBe("sk-mock-key")
    expect(captured[0]!.headers["authorization"]).toBeUndefined()
  })

  test("带 /v1 的地址会产生 /v1/v1/messages（因此 messages 模型必须用根地址）", async () => {
    captured.length = 0
    const root = `http://127.0.0.1:${server.port}/v1`
    const messageStream = stream(
      model(root),
      { messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] } as never,
      { apiKey: "sk-mock-key" } as never,
    )
    await drain(messageStream)

    expect(captured[0]!.path).toBe("/v1/v1/messages")
  })
})
