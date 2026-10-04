# endpoint-state-consistency Specification (delta)

本 delta 为 `endpoint-state-consistency` 建立新能力。Requirement 按 OpenSpec 标准组织；`MODIFIES` 关系以 `proposal.md` 的 `Modified Capabilities` 为准。

## ADDED Requirements

### Requirement: Canonical endpoint state model

The extension SHALL derive every user-visible endpoint state from a canonical model with four independent dimensions: desired state, validation state, credential state and applied runtime state. It SHALL NOT persist an "applied" or "connected" flag back into user configuration, and SHALL NOT collapse these dimensions into a single boolean.

The model MUST be a pure function of its inputs so it can be unit-tested in isolation from Pi host APIs.

#### Scenario: [STATE-DESIRED-ENABLED-INVALID] Enabled endpoint with invalid configuration

- **GIVEN** an entry in `endpoints` with a malformed `baseUrl` (not http/https, or carries userinfo)
- **WHEN** the user enables the endpoint and validation runs
- **THEN** `desired = enabled`, `validation.kind = invalid`, the user-visible status is `Enabled · Invalid configuration`
- **AND** the endpoint remains listed in `/litellm-endpoints`, endpoint detail and `/litellm-diagnostics`

#### Scenario: [STATE-DISABLED-INVALID] Disabled endpoint with invalid configuration

- **GIVEN** an entry in `endpoints` with a malformed `baseUrl`
- **WHEN** the endpoint is disabled
- **THEN** the user-visible status is `Disabled · Invalid configuration`
- **AND** the endpoint remains listed in `/litellm-endpoints`, endpoint detail and `/litellm-diagnostics`

#### Scenario: [STATE-ENABLED-NEEDS-AUTH] Enabled endpoint without a credential

- **GIVEN** an endpoint with a valid `baseUrl` and no stored API key (and, for `default`, no `LITELLM_API_KEY`)
- **WHEN** the user enables the endpoint
- **THEN** the user-visible status is `Enabled · Needs authentication`
- **AND** the next step offered in endpoint detail is "Connect API Key" / `/login`, not "edit URL"

#### Scenario: [STATE-ENABLED-NOT-APPLIED] Enabled endpoint whose runtime apply has not yet succeeded

- **GIVEN** a valid, credential-equipped endpoint that has just been enabled in a fresh process, or whose last refresh failed with a transient error
- **WHEN** the user opens `/litellm-endpoints` or `/litellm-diagnostics <id>`
- **THEN** the user-visible status is `Enabled · Not applied` until a refresh for this endpoint has succeeded in this process

#### Scenario: [STATE-ENABLED-ERROR] Enabled endpoint whose last apply failed

- **GIVEN** an enabled endpoint whose most recent refresh failed
- **WHEN** the failure category is one of `credential-missing | config-invalid | auth | network | parse`
- **THEN** the user-visible status is `Enabled · Error` and diagnostics shows the category and sanitised message

#### Scenario: [STATE-ENABLED-ACTIVE] Enabled, valid, authenticated endpoint with a successful apply

- **WHEN** an enabled endpoint has completed at least one successful refresh in this process
- **THEN** the user-visible status is `Enabled · Active` and `models = N` reflects the currently registered runtime models

#### Scenario: [STATE-DISABLED] Plain disabled endpoint

- **WHEN** an endpoint is disabled and its configuration is valid
- **THEN** the user-visible status is `Disabled`, regardless of credential state or past apply history

### Requirement: Validation uses one rule end-to-end

Endpoint address and id validation exposed to the user (Add / Edit dialog, configuration load, runtime apply) SHALL share the same rule as `normalizeLiteLLMURL` and `isEndpointID` from `litellm-discovery-core`. The adapter MUST NOT introduce extra URL heuristics beyond what the core function rejects, and MUST NOT silently fix invalid input.

#### Scenario: [VALIDATION-CONSISTENCY] A URL accepted in the Add dialog is acceptable to runtime apply

- **WHEN** a user enters a `baseUrl` via Add / Edit and the dialog accepts it
- **THEN** runtime apply does not fail with a config-invalid error for the same value

#### Scenario: [VALIDATION-INVALID-PRESERVED] Invalid endpoint stays in the registry

- **WHEN** `litellm.json` contains an endpoint whose `baseUrl` fails validation
- **THEN** the endpoint remains in the loaded registry with `validation.kind = invalid` and a human-readable `reason`
- **AND** it is never silently dropped from management, diagnostics or audit output

### Requirement: Credential state is not "connected"

Credential state SHALL be reported as one of `stored`, `environment` (legacy `default` only), `none`, or `unknown`. UI copy MUST NOT call a stored credential "connected"; a stored credential implies neither reachability nor a successful authentication.

#### Scenario: [CRED-STORED-LABEL] Stored key is labelled "saved", not "connected"

- **WHEN** an endpoint has a saved API key in `auth.json`
- **THEN** the management UI shows the credential as "已保存 API Key" (or the documented English equivalent)
- **AND** no label, summary or notification claims "已连接"/"connected" based on storage alone

#### Scenario: [CRED-MISSING-IS-NOT-INVALID] Missing credential is not an invalid configuration

- **WHEN** an enabled endpoint has no stored credential and no `LITELLM_API_KEY`
- **THEN** the user-visible status is `Enabled · Needs authentication`, not `Enabled · Invalid configuration`, and not `Disabled`

### Requirement: `/models` only reflects actually applied runtime models

The models returned from `refreshModels` for an endpoint SHALL equal the models currently registered in the Pi runtime for that endpoint, and SHALL be non-empty only when `desired = enabled`, `validation.kind = ok`, and the credential dimension is `stored` or `environment`. A persisted discovery snapshot SHALL be eligible for restore only under the same three gates, scoped to the same endpoint fingerprint.

#### Scenario: [MODELS-HIDE-DISABLED] Disabled endpoint's models disappear from `/models`

- **WHEN** a previously Active endpoint is disabled
- **THEN** its provider is unregistered, `refreshModels` returns an empty list for it, and `/models` no longer lists its models

#### Scenario: [MODELS-HIDE-UNAPPLIED] Apply-failed endpoint's models disappear from `/models`

- **GIVEN** an enabled endpoint whose most recent apply failed
- **WHEN** `/models` is queried
- **THEN** no model attributed to that endpoint's provider id is listed, even if a historical snapshot exists

#### Scenario: [MODELS-HIDE-INVALID] Invalid endpoint never publishes models

- **WHEN** an endpoint's configuration is invalid
- **THEN** `refreshModels` returns an empty list and no runtime registration is attempted for it

#### Scenario: [MODELS-SNAPSHOT-GATE] Persisted snapshot is gated by the same three dimensions

- **GIVEN** a persisted snapshot scoped to endpoint `E`
- **WHEN** `E` is disabled, invalid, or has no credential at restore time
- **THEN** the snapshot is not used to populate `/models`

### Requirement: Apply-failure does not silently revert desired state

When runtime apply fails for a desired=enabled endpoint, the persisted activation SHALL remain `enabled`. The canonical state keeps `desired=enabled` with `applied.kind=error` (or `not-applied`), and the UI shows the `Enabled · Not applied` / `Enabled · Error` markers — never a fake success, and never an automatic switch back to `Disabled`.

#### Scenario: [DESIRED-PERSISTED-ENABLED] Persisted desired state survives apply failure

- **WHEN** enabling an endpoint persists successfully but the runtime apply throws
- **THEN** `litellm.activation.json` still records that endpoint as enabled
- **AND** the UI shows `Enabled · Not applied` or `Enabled · Error`, never `Disabled`

#### Scenario: [DESIRED-NO-SILENT-ROLLBACK] Apply failure never reports fake success

- **WHEN** runtime apply fails after a user enables an endpoint
- **THEN** no success notification claims the endpoint is Active
- **AND** diagnostics reports the apply failure category instead

### Requirement: Manual retry

Endpoints whose `desired=enabled` but `applied.kind ∈ { not-applied, error }` SHALL expose an explicit "Retry" (重新应用) action in endpoint detail. Retry SHALL trigger a forced refresh of that endpoint only, SHALL NOT require a disable→enable cycle, and SHALL leave desired state unchanged.

#### Scenario: [RETRY-SUCCESS] Retry reconciles to Active

- **GIVEN** an `Enabled · Not applied` or `Enabled · Error` endpoint
- **WHEN** the user chooses Retry and the next refresh succeeds
- **THEN** the user-visible status becomes `Enabled · Active` and `/models` shows the endpoint's models

#### Scenario: [RETRY-NO-OP-FOR-DISABLED] Retry is not offered for disabled or invalid endpoints

- **WHEN** an endpoint is `Disabled`, `Disabled · Invalid configuration`, or `Enabled · Invalid configuration`
- **THEN** the Retry action is not offered in endpoint detail

### Requirement: Diagnostics endpoint detail never degrades to placeholder

`/litellm-diagnostics <endpoint-id>` SHALL output a complete per-endpoint record for every configured endpoint, regardless of desired/validation/credential/applied state. The record SHALL include at least: the user-visible status, the four canonical dimensions, the most recent error category and sanitised message if any, the last successful discovery time if any, and the currently registered model count.

#### Scenario: [DIAG-DETAIL-DISABLED] Disabled endpoint has full detail

- **WHEN** `/litellm-diagnostics <id>` is invoked on a disabled endpoint
- **THEN** the output includes desired=disabled, validation, credential, applied state, and the last error/last successful discovery fields (when present), not a "未激活 · models=0" placeholder

#### Scenario: [DIAG-DETAIL-INVALID] Invalid endpoint has full detail

- **WHEN** `/litellm-diagnostics <id>` is invoked on an endpoint whose configuration is invalid
- **THEN** the output explains the reason and shows `Enabled · Invalid configuration` or `Disabled · Invalid configuration`

#### Scenario: [DIAG-DETAIL-NEEDS-AUTH] Enabled without credential has full detail

- **WHEN** `/litellm-diagnostics <id>` is invoked on an `Enabled · Needs authentication` endpoint
- **THEN** the output states `credential = 未保存 API Key` (or env-missing equivalent) and the next step is to connect a key

### Requirement: State consistency across management, diagnostics and runtime

At any instant, `/litellm-endpoints`, endpoint detail, `/litellm-diagnostics`, `/models`, the actual provider registration and the runtime's registered models MUST agree on the same user-visible status for the same endpoint. No surface may derive its own ad-hoc truth.

#### Scenario: [CONSISTENCY-ALL-VIEWS] All surfaces agree on the canonical state

- **WHEN** an endpoint is in any of the seven user-visible statuses
- **THEN** `/litellm-endpoints`, endpoint detail title, `/litellm-diagnostics <id>`, and the runtime's provider/model registration all reflect that exact status

### Requirement: No regression on existing behaviour

The change MUST NOT reintroduce previously fixed issues (see the cross-cutting regression list in this change's design): `context.plugin.add is not a function`, `/connect` being required to "explain" past UI states, an un-interactive `/litellm-endpoints`, `/models` drifting from runtime, diagnostics detail falling back to the overview, or model `contextWindow/maxTokens = 0` leaking into the host.

#### Scenario: [REGRESSION-MODELS-ZERO-LIMIT] Models with non-positive limits are never published

- **WHEN** Core emits a `ModelSpec` whose `contextWindow <= 0` or `maxTokens <= 0`
- **THEN** the adapter's `toProviderModels` does not expose it to the host
