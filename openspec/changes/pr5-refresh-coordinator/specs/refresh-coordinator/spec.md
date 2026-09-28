# Refresh coordinator adapter

## ADDED Requirements

### Requirement: shared coordinator
The Pi adapter SHALL route network discovery through the refresh coordinator provided by litellm-discovery-core.

#### Scenario: provider lifetime
- **WHEN** the same registered provider receives multiple refresh requests
- **THEN** those requests share one coordinator instance

### Requirement: freshness and force
The Pi adapter SHALL allow Core freshness and backoff decisions to suppress redundant network discovery and SHALL map the host force flag to Core forced refresh.

#### Scenario: ordinary refresh within TTL
- **WHEN** Pi requests another non-forced network refresh within Core's freshness TTL
- **THEN** the adapter returns the coordinated cached result without another LiteLLM request

#### Scenario: forced refresh
- **WHEN** Pi supplies `force: true`
- **THEN** the adapter requests a Core forced refresh

### Requirement: failure mapping
The Pi adapter SHALL preserve host cancellation and destructive error semantics while using last-known-good for degradable failures.

#### Scenario: host cancellation
- **WHEN** the Pi refresh signal is aborted
- **THEN** the adapter does not poison Core retry state and replays the host-persisted baseline

#### Scenario: authentication failure
- **WHEN** LiteLLM returns an authentication error
- **THEN** the adapter clears coordinated state and publishes an empty model list

#### Scenario: degradable failure after success
- **WHEN** a transport, server, rate-limit, redirect, parse, or exhausted-notfound refresh fails after a successful coordinated value
- **THEN** the adapter returns the last-known-good model list marked by its warning path rather than failing the refresh

### Requirement: host lifecycle ownership
The Pi adapter SHALL continue to own polling, credential resolution, restore/publish persistence, and provider registration.

#### Scenario: polling
- **WHEN** the session poll timer fires
- **THEN** Pi invokes its model registry refresh while Core remains timer-free
