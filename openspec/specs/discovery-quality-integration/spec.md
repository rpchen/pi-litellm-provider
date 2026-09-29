# discovery-quality-integration Specification

## Purpose
Defines how Pi preserves discovery-quality semantics selected by Core, especially token-limit metadata, while mapping neutral ModelSpec values into Pi provider model configuration without adding host-specific heuristics.

## Requirements

### Requirement: Pi consumes Core token-limit semantics
Pi SHALL expose the context and output limits selected by Core without reinterpreting the discovery sources.

#### Scenario: Core total context differs from LiteLLM max input
- **WHEN** PR8 Core resolves a model to a total context that differs from LiteLLM `max_input_tokens`
- **THEN** the Pi provider model uses Core `limit.context` as `contextWindow` and preserves Core `limit.output` as `maxTokens`

### Requirement: Pi receives operational limits from capability fallback
Pi SHALL preserve non-zero Core token limits selected through models.dev provider fallback.

#### Scenario: hy4-preview original provider record is unavailable
- **WHEN** Core selects the OpenRouter hy4-preview enrichment record and returns positive context/output limits
- **THEN** Pi maps them to positive `contextWindow` and `maxTokens` values while preserving explicit LiteLLM prices

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
