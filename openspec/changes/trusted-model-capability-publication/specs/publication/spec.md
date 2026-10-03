# publication Specification (Pi adapter)

## Purpose
Pi consumes the Core trustworthy-publication verdicts without
reimplementing policy: only configured, LKG-configured, or explicitly
degraded models register; everything else stays diagnosable; reasoning
follows the Core verdict; failures never produce pseudo-complete
models.

## ADDED Requirements

### Requirement: Publication partition governs registration
The extension SHALL register only models Core reports as `configured`,
`configured-lkg`, or user-accepted `degraded`, and SHALL keep every
other discovered model out of Pi registration with its status and gaps
visible in diagnostics.

#### Scenario: Complete models register normally
- **WHEN** discovery returns Core-configured models
- **THEN** they register with correct limits, input, cost, and protocol mapping

#### Scenario: Incomplete models never disguise as normal
- **WHEN** a discovered model is missing limits or has unknown key capabilities
- **THEN** it does not register and diagnostics names its status plus missing/unknown/illegal fields

#### Scenario: Operational guard stays as second layer
- **WHEN** any spec with non-positive context or output reaches the host mapper
- **THEN** it is excluded from registration regardless of publication state

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
- **WHEN** Core reports reasoning unknown and no valid LKG or acceptance exists
- **THEN** the model does not register normally

### Requirement: Failures and LKG are visible and safe
The extension SHALL classify metadata failures with the Core taxonomy,
SHALL substitute only valid LKG snapshots (identity/schema/conflict
checked, never TTL-expired), and SHALL show live-vs-LKG selection,
failure kind, and retry state in diagnostics.

#### Scenario: Live failure with valid LKG
- **WHEN** the metadata source fails but a provably belonging complete snapshot exists
- **THEN** the model still registers with LKG provenance and diagnostics marks the LKG selection with age and reason

#### Scenario: Live failure without valid LKG
- **WHEN** no valid snapshot exists
- **THEN** the model stays in discovered-but-incomplete state with the failure kind visible, and no default-filled model registers

#### Scenario: Retry recovery
- **WHEN** a retry fetch returns complete trustworthy metadata
- **THEN** the model returns to normally configured state

### Requirement: Explicit degraded acceptance
The extension SHALL expose user-accepted degradation that keeps the
degraded label with remaining gaps and SHALL never re-label such models
as fully configured.

#### Scenario: Accept degraded model
- **WHEN** the user runs the accept-degraded command for a blocked model
- **THEN** the model registers on the degraded path and diagnostics still lists it as degraded with its gaps

#### Scenario: Degraded model is distinguishable
- **WHEN** diagnostics are displayed
- **THEN** degraded models are listed separately from fully configured models
