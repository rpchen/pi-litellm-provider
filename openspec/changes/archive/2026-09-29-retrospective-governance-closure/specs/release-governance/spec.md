# Release governance

## ADDED Requirements

### Requirement: release metadata stays aligned
Pi CI SHALL verify that package and lockfile versions match the README current-release fixed-tag example.

#### Scenario: repository release metadata is consistent
- **WHEN** a release or normal CI candidate is verified
- **THEN** the release metadata consistency check succeeds only when the manifest, lockfile and README current release refer to the same version

### Requirement: completed OpenSpec changes are archived
Pi CI SHALL reject an active OpenSpec change whose tasks are fully complete.

#### Scenario: completed change remains active
- **WHEN** an active change contains completed tasks and no unchecked tasks
- **THEN** the OpenSpec closure check fails until the change is archived through the OpenSpec workflow
