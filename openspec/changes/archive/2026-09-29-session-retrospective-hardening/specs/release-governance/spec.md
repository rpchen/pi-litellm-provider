# Release governance

## ADDED Requirements

### Requirement: release metadata stays aligned
Pi CI SHALL verify that package and lockfile versions match the README current-release fixed-tag example.

#### Scenario: repository release metadata is consistent
- **WHEN** a release or normal CI candidate is verified
- **THEN** the release metadata consistency check succeeds only when the manifest, lockfile and README current release refer to the same version
