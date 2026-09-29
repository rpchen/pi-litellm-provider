# Discovery quality integration

## ADDED Requirements

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
