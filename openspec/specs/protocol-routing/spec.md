# protocol-routing Specification

## Purpose
定义扩展如何为每个发现到的模型确定调用协议（OpenAI Chat Completions、OpenAI Responses、Anthropic Messages），协议判定结果如何映射到 pi-ai 的内置 API 实现，以及用户如何覆盖判定结果。判定顺序与 ../opencode-litellm-provider 的 protocol-routing 能力一致。

## Requirements

### Requirement: 协议判定顺序
扩展 SHALL 对每个模型按以下顺序判定协议，第一条命中即采用：
1. 扩展配置中该模型的协议覆盖（`protocolOverrides`）；
2. 上游为 Anthropic 或模型属于 Claude 家族（部署的 `litellm_provider` 或 `custom_llm_provider` 为 `anthropic`，或 `litellm_params.model` 以 `anthropic/` 开头，或 `base_model` / 模型名去掉路由前缀后以 `claude-` 开头）→ Messages；
3. 部署声明了 `supported_endpoints`：包含 `/v1/responses` → Responses；否则包含 `/v1/chat/completions` → Chat；
4. `mode` 为 `responses` → Responses；
5. 其余情况 → Chat。

#### Scenario: mode 为 responses
- **WHEN** 部署 `mode: responses`、未声明 `supported_endpoints`、上游不是 Anthropic
- **THEN** 该模型使用 Responses 协议

#### Scenario: Anthropic 上游
- **WHEN** 部署的 `litellm_params.model` 为 `anthropic/claude-sonnet-4-5`
- **THEN** 该模型使用 Messages 协议

#### Scenario: 经 Bedrock 部署的 Claude
- **WHEN** 部署的 `litellm_params.model` 为 `bedrock/anthropic.claude-sonnet-4-5`，`base_model` 为 `claude-sonnet-4-5`，`litellm_provider` 为 `bedrock`
- **THEN** 该模型使用 Messages 协议

### Requirement: 多协议时 Responses 优先
当 `supported_endpoints` 同时包含 `/v1/responses` 与 `/v1/chat/completions` 时，扩展 SHALL 选择 Responses。

#### Scenario: 同时支持两种
- **WHEN** 部署声明 `supported_endpoints: ["/v1/chat/completions", "/v1/batch", "/v1/responses"]`
- **THEN** 该模型使用 Responses 协议

### Requirement: supported_endpoints 优先于 mode
当 `supported_endpoints` 与 `mode` 指向不同协议时，扩展 SHALL 以 `supported_endpoints` 为准；声明中既不包含 `/v1/responses` 也不包含 `/v1/chat/completions` 时 SHALL 忽略该声明，继续按 `mode` 判定。

#### Scenario: 冲突
- **WHEN** 部署 `mode: chat`，且声明 `supported_endpoints: ["/v1/responses"]`
- **THEN** 该模型使用 Responses 协议

#### Scenario: 声明中没有可用的对话端点
- **WHEN** 部署声明的 `supported_endpoints` 只有 `/v1/realtime`
- **THEN** 忽略该声明，继续按 `mode` 判定

### Requirement: 多部署协议不一致时回退
同一 `model_name` 下的多个部署判定出不同协议时（未被用户覆盖），扩展 SHALL 对该模型使用 Chat 协议。

#### Scenario: 一个部署走 Anthropic，一个走 OpenAI
- **WHEN** 同名模型的两个部署分别判定为 Messages 与 Responses
- **THEN** 该模型使用 Chat 协议

### Requirement: 用户覆盖
扩展 SHALL 允许用户在扩展配置中按模型名指定协议（`chat` / `responses` / `messages`）；覆盖 SHALL 优先于所有自动判定。覆盖指向的模型不存在时 SHALL 被忽略，不报错。

#### Scenario: 覆盖为 chat
- **WHEN** 扩展配置把 `glm-5.3` 覆盖为 `chat`，而其部署 `mode: responses`
- **THEN** 该模型使用 Chat 协议

### Requirement: 协议映射到 pi-ai 内置实现
各协议 SHALL 映射到 pi-ai 的 API id 并逐模型写入注册配置：Chat → `openai-completions`；Responses → `openai-responses`；Messages → `anthropic-messages`。流式行为 SHALL 完全委托 pi-ai 对应 API 的内置实现，扩展 MUST NOT 自行实现流式处理。模型调用端点 SHALL 为 LiteLLM 的对应端点：Chat → `{根地址}/v1/chat/completions`；Responses → `{根地址}/v1/responses`；Messages → `{根地址}/v1/messages`。

#### Scenario: Responses 调用
- **WHEN** 用户在 pi 中使用走 Responses 协议的模型发送消息
- **THEN** 请求经 pi-ai `openai-responses` 实现发往 `{根地址}/v1/responses`，并携带用户的 API Key

#### Scenario: Messages 调用
- **WHEN** 用户选择被判定为 Messages 协议的 Claude 模型发送消息
- **THEN** 请求经 pi-ai `anthropic-messages` 实现发往 `{根地址}/v1/messages`，初始化不出现包解析错误
