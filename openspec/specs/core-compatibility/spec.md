# core-compatibility Specification

## Purpose
Defines how the Pi plugin validates an immutable litellm-discovery-core commit through its compatibility workflow, including SHA selection, complete consumer checks, and provenance evidence for cross-repository changes.

## Requirements

### Requirement: Pi compatibility entrypoint
The repository SHALL provide manual and `repository_dispatch` compatibility verification for a complete Core SHA.

#### Scenario: valid Core SHA
- **WHEN** the workflow receives a valid `core_sha`
- **THEN** it runs typecheck, tests, distribution build, and package verification against that SHA

#### Scenario: invalid Core SHA
- **WHEN** the workflow receives a missing or malformed SHA
- **THEN** it fails before installing or building
