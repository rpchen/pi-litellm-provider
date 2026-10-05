# discovery-resilience-integration Specification

## Purpose
Pi 对 Core discovery-resilience 与 trusted-publication 事实的宿主适配：把 publishable / withheld / partial / unusable / regression / LKG 映射为 Pi 的 provider 注册、用户提醒与 diagnostics，且不复制任何 Core 判定、不提供任何绕过 publication gate 的用户动作。

## Requirements

### Requirement: Adapter consumes Core publication facts without re-deriving policy
The extension SHALL consume Core's publication partition, catalog facts, withheld reasons, evidence resolutions, and acknowledgement decision verbatim, and SHALL NOT re-derive completeness, conflict, eligibility, or authority judgments locally.

#### Scenario: Conflict-blocked groups stay blocked
- **WHEN** Core reports a model withheld for an unresolved conflict (limits disagree or identities cannot be proven equal)
- **THEN** the model stays unregistered with status and conflict fields visible in diagnostics

#### Scenario: Published set is exactly Core's publishable set
- **WHEN** diagnostics are displayed
- **THEN** the registered model ids equal Core's `publishable` ids, and every other discovered model is listed as withheld with its reason codes

### Requirement: Partial catalog availability is published immediately
The extension SHALL register every model Core reports publishable in the same round, regardless of how many other models are withheld, and SHALL require no user action for that publication.

#### Scenario: Partially available catalog
- **WHEN** Core reports a subset of discovered models publishable and others withheld
- **THEN** the publishable subset registers immediately and diagnostics reports the partial-availability counts with each withheld model's reasons

#### Scenario: Withheld models never enter the host or the snapshot
- **WHEN** a model is withheld
- **THEN** it is absent from the Pi provider model list and from the persisted endpoint snapshot, and no acceptance state can add it

### Requirement: Withheld availability changes are surfaced appropriately
The extension SHALL distinguish a previously published model becoming withheld from a newly discovered model that cannot be published. A regression and an unusable catalog SHALL be surfaced as an immediate user notification naming the affected models and pointing at retry and diagnostics; a first withholding of a newly discovered model SHALL be visible in diagnostics without interrupting the user. Notification suppression SHALL survive host restarts: Pi SHALL persist the Core-produced publication memory (acknowledgement plus the regression baseline) with the endpoint's persisted catalog and restore it before the next discovery round, so the same fingerprint observed after a restart stays quiet while a materially changed problem set is surfaced again. Unreadable persisted memory SHALL be ignored and SHALL NOT change which models are published.

#### Scenario: Regression is announced
- **WHEN** a model the previous applied catalog published is withheld this round
- **THEN** Pi notifies the user that the model was withdrawn, why it is not safe to use, and that it will not be silently substituted by another model

#### Scenario: Unusable catalog is announced
- **WHEN** discovered models exist and none can be published
- **THEN** Pi notifies the user that the endpoint is connected but no model can currently be published safely, and mentions retry plus diagnostics

#### Scenario: First-time gap stays non-interruptive
- **WHEN** a newly discovered model is withheld and no previously published model regressed
- **THEN** Pi does not interrupt the user and the reason is visible in diagnostics

#### Scenario: Repeated unchanged problems do not spam
- **WHEN** the same withheld model set with the same material reasons is observed again
- **THEN** Pi does not repeat the notification

#### Scenario: Suppression survives a host restart
- **WHEN** the user was told about a problem set and Pi restarts with the same fingerprint
- **THEN** Pi does not notify again, still lists every withheld model with its reason in diagnostics, and reports that the problem set is already acknowledged

#### Scenario: Material change after a restart is announced
- **WHEN** a restored acknowledgement exists and the withheld set grows or a model's reason materially changes
- **THEN** Pi notifies the user again

#### Scenario: Persisted memory never changes publication
- **WHEN** persisted memory is restored, corrupt, or absent
- **THEN** the registered model set and the withheld reasons are identical; only the notification decision differs

### Requirement: Withdrawn models are never silently substituted
The extension SHALL NOT change the user's model selection or silently route requests to another model when a previously published model becomes withheld, and SHALL keep the notification/acknowledgement machinery free of any effect on publication.

#### Scenario: No silent model substitution
- **WHEN** a model becomes withheld while it is the selected model
- **THEN** Pi reports the withdrawal and requires the user to refresh or pick another model; it never substitutes one automatically

#### Scenario: Acknowledgement only suppresses notifications
- **WHEN** an acknowledgement state exists for the current problem set
- **THEN** the published model set and the withheld reasons are identical to the state without acknowledgement

### Requirement: Trusted LKG is presented as verified configuration
The extension SHALL present a model published from a trusted snapshot as previously verified configuration — with its provenance and age — and SHALL NOT describe it as a guess, degraded state, or unverified metadata.

#### Scenario: LKG provenance is visible
- **WHEN** a model is published from LKG
- **THEN** diagnostics reports that the current metadata refresh is unavailable, the configuration comes from a previously verified result, and the snapshot's fetch time and age
