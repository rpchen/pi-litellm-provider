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

### Requirement: Pi publishes only operational model limits
Pi SHALL NOT register a Core ModelSpec as a usable provider model when its context or output token limit is non-positive.

#### Scenario: neutral private model has unknown limits
- **WHEN** Core returns a neutral ModelSpec with context or output equal to zero
- **THEN** Pi omits it from provider model registration while Core diagnostics remain able to report the discovered model

#### Scenario: valid model accompanies an invalid model
- **WHEN** one Core ModelSpec has positive operational limits and another does not
- **THEN** Pi registers the valid model and omits only the non-operational model
