# Discovery quality integration

## ADDED Requirements

### Requirement: Pi publishes only operational model limits
Pi SHALL NOT register a Core ModelSpec as a usable provider model when its context or output token limit is non-positive.

#### Scenario: neutral private model has unknown limits
- **WHEN** Core returns a neutral ModelSpec with context or output equal to zero
- **THEN** Pi omits it from provider model registration while Core diagnostics remain able to report the discovered model

#### Scenario: valid model accompanies an invalid model
- **WHEN** one Core ModelSpec has positive operational limits and another does not
- **THEN** Pi registers the valid model and omits only the non-operational model
