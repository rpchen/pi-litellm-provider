# provider-diagnostics Specification

## Purpose
Defines Pi user-facing LiteLLM diagnostics, including discovery status, cache source and freshness, models.dev and protocol summaries, safe failure reporting, and the zero-model-turn command path.

## Requirements

### Requirement: user-invokable diagnostics
The extension SHALL register /litellm-diagnostics and SHALL render the current LiteLLM diagnostic state using Pi's native command UI without sending a model turn.

#### Scenario: run diagnostics after successful discovery
- **WHEN** the user runs /litellm-diagnostics after discovery succeeds
- **THEN** the UI reports healthy status, model count, Core provenance, cache source, models.dev match statistics and protocol fallback count

### Requirement: cache source visibility
The adapter SHALL distinguish persisted snapshot restore, network discovery, short in-memory cache reuse and stale last-known-good fallback.

#### Scenario: startup restore
- **WHEN** endpoint-compatible models are restored before network access
- **THEN** diagnostics report snapshot source and restored/stale state

### Requirement: safe failure reporting
The adapter SHALL classify unconfigured, authentication, configuration and degradable discovery failures without putting credentials, endpoint URLs or raw error bodies in the user-facing diagnostic payload.

#### Scenario: authentication failure
- **WHEN** LiteLLM rejects the credential
- **THEN** diagnostics report an authentication category and zero registered models without echoing the credential

### Requirement: shared diagnostic semantics
The adapter SHALL consume Core diagnostics from the same model build used for registration.

#### Scenario: models.dev fallback
- **WHEN** models.dev enrichment is degraded
- **THEN** the Pi diagnostic output reflects Core's degraded/match statistics while registration continues with the normal LiteLLM-only fallback
