import { describe, expect, test } from "bun:test"
import fixture from "./fixtures/litellm-model-info.json" with { type: "json" }
import { groupLiteLLMDeployments, type DeploymentGroup } from "../src/core/litellm.ts"
import { deploymentProtocol, resolveProtocol } from "../src/core/protocol.ts"

function group(data: Record<string, unknown>[]): DeploymentGroup {
  return groupLiteLLMDeployments({ data })[0]!
}

function deployment(modelInfo: Record<string, unknown>, model = "openai/model") {
  return group([{ model_name: "model", litellm_params: { model }, model_info: modelInfo }]).deployments[0]!
}

describe("协议判定", () => {
  test("mode responses 与 chat", () => {
    expect(deploymentProtocol(deployment({ mode: "responses" }))).toBe("responses")
    expect(deploymentProtocol(deployment({ mode: "chat" }))).toBe("chat")
  })

  test("Anthropic 上游与 Bedrock Claude 使用 Messages", () => {
    expect(deploymentProtocol(deployment({ mode: "chat" }, "anthropic/claude-sonnet-4-5"))).toBe("messages")
    expect(
      deploymentProtocol(
        deployment(
          { mode: "chat", base_model: "claude-sonnet-4-5", litellm_provider: "bedrock" },
          "bedrock/anthropic.claude-sonnet-4-5",
        ),
      ),
    ).toBe("messages")
  })

  test("custom_llm_provider 为 anthropic 时使用 Messages", () => {
    expect(
      deploymentProtocol(deployment({ mode: "chat" }, "claude-sonnet-4-5")),
    ).toBe("messages")
  })

  test("supported_endpoints 多协议时 Responses 优先且优先于 mode", () => {
    expect(
      deploymentProtocol(
        deployment({
          mode: "chat",
          supported_endpoints: ["/v1/chat/completions", "/v1/responses"],
        }),
      ),
    ).toBe("responses")
    expect(
      deploymentProtocol(
        deployment({
          mode: "responses",
          supported_endpoints: ["/v1/chat/completions"],
        }),
      ),
    ).toBe("chat")
  })

  test("端点写法不带 /v1 前缀也识别", () => {
    expect(deploymentProtocol(deployment({ mode: "chat", supported_endpoints: ["/responses"] }))).toBe(
      "responses",
    )
    expect(deploymentProtocol(deployment({ mode: "responses", supported_endpoints: ["chat/completions"] }))).toBe(
      "chat",
    )
  })

  test("无效端点声明被忽略", () => {
    expect(
      deploymentProtocol(deployment({ mode: "responses", supported_endpoints: ["/v1/realtime"] })),
    ).toBe("responses")
  })

  test("同名部署协议不一致时回退 Chat", () => {
    const mixed = group([
      {
        model_name: "model",
        litellm_params: { model: "anthropic/claude-haiku" },
        model_info: { mode: "chat" },
      },
      {
        model_name: "model",
        litellm_params: { model: "openai/gpt" },
        model_info: { mode: "responses" },
      },
    ])
    expect(resolveProtocol(mixed)).toBe("chat")
  })

  test("用户覆盖优先，未知模型覆盖自然忽略", () => {
    const responses = group([
      { model_name: "model", litellm_params: { model: "openai/model" }, model_info: { mode: "responses" } },
    ])
    expect(resolveProtocol(responses, { model: "chat", missing: "messages" })).toBe("chat")
  })

  test("真实样本中的三协议分布符合预期", () => {
    const groups = groupLiteLLMDeployments(fixture)
    const byName = new Map(groups.map((item) => [item.modelName, item]))
    expect(resolveProtocol(byName.get("gpt-6-sol")!)).toBe("responses")
    expect(resolveProtocol(byName.get("mimo-v2.6-pro")!)).toBe("chat")
    expect(resolveProtocol(byName.get("claude-db")!)).toBe("messages")
    expect(resolveProtocol(byName.get("claude-bedrock")!)).toBe("messages")
    // supported_endpoints declares only /v1/responses
    expect(resolveProtocol(byName.get("responses-only-model")!)).toBe("responses")
    // Same model_name, one Anthropic (messages) one OpenAI (responses) → chat
    expect(resolveProtocol(byName.get("shared-route")!)).toBe("chat")
  })
})
