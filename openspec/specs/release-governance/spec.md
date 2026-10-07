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
- **WHEN** an active OpenSpec change contains completed tasks and no unchecked tasks
- **THEN** the OpenSpec closure check fails until the change is archived through the OpenSpec workflow

### Requirement: tagged releases repeat the real Pi host gate
Pi Release workflow SHALL install the immutable release tag through Pi's own package installer and SHALL pass the same Real Pi 0.87.1 E2E host-contract checks before creating the GitHub Release assets.

#### Scenario: release tag is not host-compatible
- **WHEN** a version tag passes unit/package checks but fails installation, loading, provider/model, credential, command or activation validation in the real Pi host
- **THEN** the Release workflow fails before publishing the GitHub Release

### Requirement: main merge gate requires both CI and the real host E2E
The `Protect main` ruleset SHALL require both the `CI` and the `Real Pi 0.87.1 E2E` status checks as merge conditions, and Pi CI SHALL verify the live ruleset against this frozen baseline so a future drift fails the pipeline instead of silently weakening the gate.

The exact required context names are taken from real GitHub Actions check runs (never guessed from workflow job names or YAML files).

#### Scenario: merge gate requires both checks
- **WHEN** the live `Protect main` ruleset is queried from the GitHub ruleset API
- **THEN** its required status checks are exactly `CI` and `Real Pi 0.87.1 E2E` under the strict required-checks policy

#### Scenario: release candidate passes the real host gate before merging
- **WHEN** a release PR is merged into main
- **THEN** both `CI` and `Real Pi 0.87.1 E2E` on the PR head completed successfully under the ruleset's merge conditions

#### Scenario: governance drift fails the pipeline
- **WHEN** the ruleset's required checks no longer match the frozen baseline (for example `Real Pi 0.87.1 E2E` is removed again)
- **THEN** the CI drift check fails and the pipeline is red until the ruleset is restored

#### Scenario: other protections stay frozen
- **WHEN** the ruleset is modified to add the missing required check
- **THEN** enforcement, target refs, squash-only merge methods, review-thread resolution, bypass-free configuration, and deletion / non-fast-forward protection remain unchanged, proven by before/after ruleset reads
