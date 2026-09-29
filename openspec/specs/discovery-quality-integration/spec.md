# discovery-quality-integration Specification

## Purpose
Defines how Pi preserves discovery-quality semantics selected by Core, especially token-limit metadata, while mapping neutral ModelSpec values into Pi provider model configuration without adding host-specific heuristics.

## Requirements

### Requirement: Pi consumes Core token-limit semantics
Pi SHALL expose the context and output limits selected by Core without reinterpreting the discovery sources.

#### Scenario: Core total context differs from LiteLLM max input
- **WHEN** PR8 Core resolves a model to a total context that differs from LiteLLM `max_input_tokens`
- **THEN** the Pi provider model uses Core `limit.context` as `contextWindow` and preserves Core `limit.output` as `maxTokens`
