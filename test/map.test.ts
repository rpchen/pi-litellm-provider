import { describe, expect, test } from "bun:test"
import { PROTOCOL_API, toProviderModels } from "../src/extension/map.ts"

describe("protocol -> pi-ai api mapping", () => {
  test("maps every LiteLLM protocol to a pi-ai API id", () => {
    expect(PROTOCOL_API.chat).toBe("openai-completions")
    expect(PROTOCOL_API.responses).toBe("openai-responses")
    expect(PROTOCOL_API.messages).toBe("anthropic-messages")
  })

  test("has no unmapped protocol", () => {
    expect(Object.keys(PROTOCOL_API).sort()).toEqual(["chat", "messages", "responses"])
  })

  test("model mapping is wired but not implemented yet", () => {
    expect(toProviderModels()).toEqual([])
  })
})
