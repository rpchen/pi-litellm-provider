# Persisted discovery snapshot adapter

## ADDED Requirements

### Requirement: endpoint-compatible restore
Pi SHALL restore persisted discovery data only when Core accepts the stored snapshot for the current endpoint fingerprint.

#### Scenario: compatible restore
- **WHEN** restore runs without network access and the stored snapshot matches the current endpoint, credential, and discovery options
- **THEN** Pi rebuilds the provider model list from the neutral stored snapshot

#### Scenario: credential-bound incompatible restore
- **WHEN** the host supplies a credential and the full endpoint fingerprint no longer matches
- **THEN** Pi returns no restored models rather than replaying the old catalog

#### Scenario: restore phase without credential
- **WHEN** the host omits the credential during restore-only startup
- **THEN** Pi restores only when the persisted anonymous URL/options scope matches and Core validates the snapshot's schema and model fingerprint

### Requirement: snapshot persistence
A successful network discovery SHALL persist the Core discovery snapshot alongside Pi's host-facing model list.

#### Scenario: first success
- **WHEN** discovery succeeds for a configured endpoint
- **THEN** the host catalog persistence payload includes the neutral snapshot

#### Scenario: endpoint changes with same models
- **WHEN** a new endpoint yields the same host model list as the previous endpoint
- **THEN** Pi still persists the new endpoint-bound snapshot

### Requirement: drift observation
Pi SHALL compare the previous compatible snapshot with a newly successful snapshot.

#### Scenario: compatibility drift
- **WHEN** model membership, protocol, or capabilities change
- **THEN** Pi records a warning summarizing the drift counts

### Requirement: host-owned persistence
Pi SHALL NOT create a separate filesystem cache for PR6 snapshots.

#### Scenario: persistence transport
- **WHEN** Pi stores or restores the snapshot
- **THEN** it uses the existing provider `stored` / `publish` lifecycle surface
