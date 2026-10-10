# Spec Delta

## MODIFIED Requirements

### Requirement: Activation management
Activation SHALL keep its existing independent semantics and SHALL take effect immediately. An active endpoint's provider registration SHALL be preserved while its host-visible Base URL is unchanged, while explicit model refreshes continue to run. When a Base URL changes, the affected provider SHALL use the new address on the next refresh.

#### Scenario: [ACT-TOGGLE] Activate and deactivate
- **WHEN** the user activates or deactivates an endpoint
- **THEN** its provider is registered or unregistered immediately and the choice is persisted in `litellm.activation.json`

#### Scenario: [ACT-ZERO] Zero active endpoints
- **WHEN** the user deactivates every endpoint
- **THEN** no provider is exposed and the state is valid

#### Scenario: [ACT-CRED-INDEPENDENT] Deactivation keeps credential and snapshot
- **WHEN** an endpoint is deactivated
- **THEN** its credential and persisted snapshot are kept

#### Scenario: [ACT-IMMEDIATE] Provider exposure follows activation at once
- **WHEN** an endpoint with a credential is activated
- **THEN** its models become visible without restarting Pi, and they disappear again when it is deactivated

#### Scenario: [ACT-STABLE-REGISTRATION] Refresh preserves unchanged providers and applies changed Base URLs
- **WHEN** the user runs `/litellm-endpoints all` with active endpoint configurations that are unchanged or have a changed Base URL
- **THEN** the command performs an explicit model refresh for every active endpoint, preserves registrations for unchanged Base URLs, and updates only providers whose Base URL changed
