# diagnostics Specification

## Purpose
Defines Pi diagnostics presentation requirements for host-local absolute timestamps while preserving the underlying UTC or epoch discovery state and using a stable explicit UTC offset in user-visible output.

## Requirements

### Requirement: host-local absolute time
Pi SHALL render user-visible absolute diagnostics timestamps in the timezone of the machine running Pi without mutating the underlying UTC/epoch discovery state.

#### Scenario: host is UTC+08:00
- **WHEN** a discovery instant is `2026-09-29T01:07:32.160Z` and the running host is UTC+08:00
- **THEN** diagnostics display `2026-09-29 09:07:32 UTC+08:00` while the stored discovery instant remains unchanged

#### Scenario: retry time is shown
- **WHEN** diagnostics include a future retry timestamp
- **THEN** the retry time uses the same host-local timezone format as the last-success timestamp
