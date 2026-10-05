# publication Specification

## Purpose
Pi consumes the Core trustworthy-publication verdicts without
reimplementing policy: only configured, LKG-configured, or explicitly
degraded models register; everything else stays diagnosable; reasoning
follows the Core verdict; failures never produce pseudo-complete
models.

## Requirements

### Requirement: Publication partition governs registration
The extension SHALL register only models Core reports as `configured` or
`configured-lkg`, and SHALL keep every other discovered model out of Pi
registration with its status and complete reason list visible in
diagnostics. No user confirmation, acceptance, or override exists or may
be added: a withheld model cannot be moved into the published set by any
Pi action.

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

### Requirement: Reasoning follows the Core verdict
The extension SHALL set the Pi `reasoning` flag from the Core
`reasoningSupported` verdict, and SHALL report support-without-levels as
reasoning-capable with no level map.

#### Scenario: Toggle-style reasoning without levels
- **WHEN** a model is reasoning-supported with no selectable levels
- **THEN** it registers with `reasoning: true` and no `thinkingLevelMap`

#### Scenario: Confirmed non-reasoning model
- **WHEN** Core reports reasoning unsupported
- **THEN** the model registers with `reasoning: false` and no level map

#### Scenario: Unknown reasoning blocks normal registration
- **WHEN** Core reports reasoning unknown and no valid LKG snapshot exists
- **THEN** the model does not register normally

### Requirement: Failures and LKG are visible and safe
The extension SHALL classify metadata failures with the Core taxonomy,
SHALL substitute only valid LKG snapshots (identity/schema/conflict
checked by Core, never TTL-expired), and SHALL show live-vs-LKG
selection, the LKG provenance and age, failure kind, and retry state in
diagnostics. A descriptive LiteLLM metadata difference reported by Core
as a resolved discrepancy SHALL NOT be presented as a failure and SHALL
NOT discard a trusted snapshot.

#### Scenario: Live failure with valid LKG
- **WHEN** the metadata source fails but a provably belonging complete snapshot exists
- **THEN** the model still registers with LKG provenance and diagnostics marks the LKG selection with age and reason

#### Scenario: Live failure without valid LKG
- **WHEN** no valid snapshot exists
- **THEN** the model stays withheld with the failure kind and reason visible, and no default-filled model registers

#### Scenario: Retry recovery
- **WHEN** a retry fetch returns complete trustworthy metadata
- **THEN** the model returns to normally configured state

#### Scenario: Descriptive discrepancy keeps the trusted snapshot
- **WHEN** Core reports a resolved discrepancy for a model that is otherwise served from LKG
- **THEN** the model stays registered from the trusted snapshot and diagnostics shows both the discrepancy and the LKG provenance
