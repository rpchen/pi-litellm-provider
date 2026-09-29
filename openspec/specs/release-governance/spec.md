# release-governance Specification

## Purpose
Defines release metadata and completion checks that keep Pi package versions, README current-release instructions, OpenSpec archive state, and published release inputs consistent.

## Requirements

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

### Requirement: tagged releases repeat the real Pi host gate
Pi Release workflow SHALL install the immutable release tag through Pi's own package installer and SHALL pass the same Real Pi 0.87.1 E2E host-contract checks before creating the GitHub Release assets.

#### Scenario: release tag is not host-compatible
- **WHEN** a version tag passes unit/package checks but fails installation, loading, provider/model, credential, command or activation validation in the real Pi host
- **THEN** the Release workflow fails before publishing the GitHub Release

