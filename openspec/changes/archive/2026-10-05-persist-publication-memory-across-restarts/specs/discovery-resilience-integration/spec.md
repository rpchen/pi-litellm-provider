## MODIFIED Requirements

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

