## MODIFIED Requirements

### Requirement: tagged releases repeat the real Pi host gate
Pi Release workflow SHALL install the immutable release tag through Pi's own package installer and SHALL pass the same Real Pi latest E2E host-contract checks before creating the GitHub Release assets.

#### Scenario: release tag is not host-compatible
- **WHEN** a version tag passes unit/package checks but fails installation, loading, provider/model, credential, command or activation validation in the real Pi host
- **THEN** the Release workflow fails before publishing the GitHub Release

### Requirement: main merge gate requires both CI and the real host E2E
The `Protect main` ruleset SHALL require both the `CI` and the `Real Pi latest E2E` status checks as merge conditions, and Pi CI SHALL verify the live ruleset against this frozen baseline so a future drift fails the pipeline instead of silently weakening the gate.

The exact required context names are taken from real GitHub Actions check runs (never guessed from workflow job names or YAML files).

#### Scenario: merge gate requires both checks
- **WHEN** the live `Protect main` ruleset is queried from the GitHub ruleset API
- **THEN** its required status checks are exactly `CI` and `Real Pi latest E2E` under the strict required-checks policy

#### Scenario: release candidate passes the real host gate before merging
- **WHEN** a release PR is merged into main
- **THEN** both `CI` and `Real Pi latest E2E` on the PR head completed successfully under the ruleset's merge conditions

#### Scenario: governance drift fails the pipeline
- **WHEN** the ruleset's required checks no longer match the frozen baseline (for example `Real Pi latest E2E` is removed again)
- **THEN** the CI drift check fails and the pipeline is red until the ruleset is restored

#### Scenario: other protections stay frozen
- **WHEN** the ruleset is modified to add the missing required check
- **THEN** enforcement, target refs, squash-only merge methods, review-thread resolution, bypass-free configuration, and deletion / non-fast-forward protection remain unchanged, proven by before/after ruleset reads
