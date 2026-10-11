# discovery-quality-integration Specification

## Purpose
Defines how Pi preserves discovery-quality semantics selected by Core, especially token-limit metadata, while mapping neutral ModelSpec values into Pi provider model configuration without adding host-specific heuristics.

## Requirements

### Requirement: Pi consumes Core token-limit semantics
Pi SHALL expose the context and output limits selected by Core without reinterpreting the discovery sources.

#### Scenario: Core total context differs from LiteLLM max input
- **WHEN** PR8 Core resolves a model to a total context that differs from LiteLLM `max_input_tokens`
- **THEN** the Pi provider model uses Core `limit.context` as `contextWindow` and preserves Core `limit.output` as `maxTokens`

### Requirement: Pi does not publish non-operational token limits
Pi SHALL NOT register a host model when Core reports a non-positive total context or output token limit.

#### Scenario: context limit is unknown
- **WHEN** a Core ModelSpec has `limit.context <= 0`
- **THEN** Pi omits that model from provider registration while Core diagnostics may still retain it

#### Scenario: output limit is unknown
- **WHEN** a Core ModelSpec has `limit.output <= 0`
- **THEN** Pi omits that model from provider registration while valid models remain available

#### Scenario: operational limits are valid
- **WHEN** both Core context and output limits are positive
- **THEN** Pi maps and registers the model normally

### Requirement: Pi preserves selected limits and reference prices
Pi SHALL 保留Core选中整条记录的limits、model_name身份与该记录参考价或0；不再保留LL价格优先。

#### Scenario: [T28] 后备元数据
- **WHEN** 官方缺失，Core选择OpenCode或OpenRouter
- **THEN** 限制和价格按Core结果映射，ID不变
