# Discovery quality integration

## ADDED Requirements

### Requirement: Pi receives operational limits from capability fallback
Pi SHALL preserve non-zero Core token limits selected through models.dev provider fallback.

#### Scenario: hy4-preview original provider record is unavailable
- **WHEN** Core selects the OpenRouter hy4-preview enrichment record and returns positive context/output limits
- **THEN** Pi maps them to positive `contextWindow` and `maxTokens` values while preserving explicit LiteLLM prices
