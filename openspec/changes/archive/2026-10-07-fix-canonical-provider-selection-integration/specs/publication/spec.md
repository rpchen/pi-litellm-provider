# Delta: publication

## MODIFIED Requirements

### Requirement: Publication partition governs registration
The extension SHALL register only models Core reports as `configured` or `configured-lkg`, and SHALL keep every other discovered model out of Pi registration with its status and complete reason list visible in diagnostics. No user confirmation, acceptance, or override exists or may be added: a withheld model cannot be moved into the published set by any Pi action.

#### Scenario: Complete models register normally
- **WHEN** discovery returns Core-configured models
- **THEN** they register with correct limits, input, cost, and protocol mapping

#### Scenario: Incomplete models never disguise as normal
- **WHEN** a discovered model is missing limits or has unknown key capabilities
- **THEN** it does not register and diagnostics names its status plus missing/unknown/illegal fields

#### Scenario: Operational guard stays as second layer
- **WHEN** any spec with non-positive context or output reaches the host mapper
- **THEN** it is excluded from registration regardless of publication state

#### Scenario: Repeated refreshes never force a withheld model in
- **WHEN** a withheld model is refreshed repeatedly and no user action is taken
- **THEN** every refresh returns the same withheld result; there is no command, flag, or stored state that changes it

#### Scenario: DeepSeek official provider limits reach the Pi host config
- **WHEN** the endpoint serves `deepseek-v4.1-flash` (descriptive `model_info` output cap 384000/393216-class values) and the Core publication resolves the canonical identity `deepseek/deepseek-v4.1-flash` to the official `deepseek` provider record (`selectionSource: canonical-original`, `limit.output = 393216`)
- **THEN** the registered Pi model maps `spec.limit.context` to `contextWindow` and `spec.limit.output` to `maxTokens` with `maxTokens = 393216`, never the OpenRouter reseller serving limit `943718`

#### Scenario: Reseller fallback conflicts stay withheld
- **WHEN** no official provider record is provable and the fallback-selected OpenRouter record's serving limit conflicts with the endpoint's own declarations
- **THEN** the model is withheld, `maxTokens = 943718` never reaches Pi registration, and diagnostics report the unresolved conflict with the fallback serving evidence origin

#### Scenario: Fallback never rewrites the canonical identity
- **WHEN** discovery selects an OpenCode or OpenRouter fallback record for a model whose deployment identity is `deepseek-v4.1-flash`
- **THEN** the registered model id and candidate names remain the deployment's own identity (never `opencode/...` or `openrouter/...`)