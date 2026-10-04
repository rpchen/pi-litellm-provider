# Tasks

> Scenario coverage follows `litellm-discovery-core/docs/testing-standard.md`. Each `[TAG]` maps to a Scenario in `specs/endpoint-state-consistency/spec.md`; each tag has at least one piece of traceable automated evidence.

## 1. Canonical endpoint state model (pure)

- [ ] 1.1 Create `src/extension/endpoint-state.ts` implementing `EndpointState`, `UserVisibleStatus`, `userVisibleStatus(state)`, Chinese label maps, and `ApplyErrorCategory`. Pure, no Pi imports.
- [ ] 1.2 Unit tests `test/endpoint-state.test.ts` cover:
  - [STATE-DESIRED-ENABLED-INVALID] desired=enabled ∧ invalid → `enabled-invalid-configuration`
  - [STATE-DISABLED-INVALID] desired=disabled ∧ invalid → `disabled-invalid`
  - [STATE-ENABLED-NEEDS-AUTH] enabled + credential=none/unknown → `enabled-needs-authentication`
  - [STATE-ENABLED-NOT-APPLIED] enabled + valid + credential=stored + applied=not-applied → `enabled-not-applied`
  - [STATE-ENABLED-ERROR] enabled + valid + credential + applied=error → `enabled-error`
  - [STATE-ENABLED-ACTIVE] enabled + valid + credential + applied=active → `enabled-active`
  - [STATE-DISABLED] disabled + valid → `disabled`
  - [CRED-STORED-LABEL] `stored` maps to "已保存 API Key", `none` to "未保存 API Key", `environment` to "API Key 来自环境变量", `unknown` to "凭据状态未知"
  - [CRED-MISSING-IS-NOT-INVALID] missing credential never produces an invalid status
  - [REGRESSION-MODELS-ZERO-LIMIT] predicate consumed by `toProviderModels` keeps existing ≤0 guard

## 2. Registry keeps invalid endpoints

- [ ] 2.1 Change `src/extension/config.ts`: `loadEndpointRegistry` returns endpoints that fail URL validation with `validation.kind = "invalid"` and empty `baseUrl`, instead of dropping them. Add `validation: ValidationState` on `ExtensionConfig`.
- [ ] 2.2 Unit tests cover [VALIDATION-CONSISTENCY] and [VALIDATION-INVALID-PRESERVED].

## 3. Applied state tracking in the adapter

- [ ] 3.1 Track per-endpoint `AppliedState` in `src/extension/index.ts`, written from `syncProviders`, `refreshModels` results, and deactivate flows.
- [ ] 3.2 `refreshModels` updates `applied` after each refresh: success → `active`, category-tagged error → `error`, cancellation leaves the previous value unchanged.
- [ ] 3.3 Desired state is never rewritten on apply failure ([DESIRED-PERSISTED-ENABLED], [DESIRED-NO-SILENT-ROLLBACK]).
- [ ] 3.4 Unit + integration tests covering the transitions.

## 4. `/models` strict semantics

- [ ] 4.1 Gate `refreshProviderModels` results on `desired=enabled ∧ validation=ok ∧ credential∈{stored, environment}` for both network refresh and snapshot restore.
- [ ] 4.2 Deactivate → unregister, force `refreshModels` return `[]`, persist empty catalog ([MODELS-HIDE-DISABLED]).
- [ ] 4.3 Apply-failed endpoints return `[]` even when a historical snapshot exists ([MODELS-HIDE-UNAPPLIED]).
- [ ] 4.4 Invalid endpoints never register and never return models ([MODELS-HIDE-INVALID]).
- [ ] 4.5 Snapshot restore requires endpoint fingerprint match AND the three gates ([MODELS-SNAPSHOT-GATE]).
- [ ] 4.6 Integration tests for each scenario.

## 5. Management UI (Pi)

- [ ] 5.1 `endpoint-management.ts` list rows and detail titles derive from `userVisibleStatus` (single source of truth).
- [ ] 5.2 Replace "已连接" / "未连接" credential labels with the new four labels everywhere (list row, detail title, Add confirmation post-state).
- [ ] 5.3 Add explicit "Retry / 重新应用" action in endpoint detail only when `userVisibleStatus ∈ {enabled-not-applied, enabled-error, enabled-needs-authentication}`. Disabled and invalid endpoints do not show Retry ([RETRY-NO-OP-FOR-DISABLED]).
- [ ] 5.4 Apply failure notifies honestly (warn-level: "已启用，但运行时尚未生效：<reason>") — never reports success ([DESIRED-NO-SILENT-ROLLBACK]).
- [ ] 5.5 Tests under `test/endpoint-management.test.ts` extended: [CONSISTENCY-ALL-VIEWS] across list row ↔ detail title ↔ diagnostics.

## 6. Diagnostics command

- [ ] 6.1 `/litellm-diagnostics <id>` prints the full per-endpoint record for any state (disabled / invalid / needs-auth / not-applied / error / active). Never falls back to "未激活 · models=0" ([DIAG-DETAIL-DISABLED] [DIAG-DETAIL-INVALID] [DIAG-DETAIL-NEEDS-AUTH]).
- [ ] 6.2 No-arg overview lists every configured endpoint with `✓/○`, provider id, user-visible status and `models=N`.
- [ ] 6.3 Diagnostics never includes URL, API key, raw error bodies.

## 7. Real Pi E2E (gate per AGENTS.md §13)

- [ ] 7.1 Extend `scripts/e2e-real-pi.mjs` against real Pi 0.87.1 with the following scenarios, each asserting a user-visible outcome (not just internal calls):
  - Scenario A: disabled → enable → apply success → UI shows `Enabled · Active` → models appear in `/models` → diagnostics shows applied.
  - Scenario B: Active → disable → provider unregistered → UI shows `Disabled` → `/models` empty for that endpoint.
  - Scenario C: enabled endpoint with no API key → UI shows `Enabled · Needs authentication` → no models → save key via management UI (or `/login`) → apply → `Enabled · Active`.
  - Scenario D: invalid endpoint → still listed → `Invalid configuration` clear in management and diagnostics → no provider registered → `/models` unaffected. Also covers `Disabled · Invalid configuration`.
  - Scenario E: enable with simulated runtime apply failure → persisted desired=enabled → UI shows `Enabled · Not applied` / `Enabled · Error` → `/models` shows no models for the endpoint → diagnostics reports failure.
  - Scenario F: `Enabled · Not applied` → fix external condition → Retry → `Enabled · Active` → `/models` populated.
  - Regression sweep: `context.plugin.add is not a function`, `/litellm-endpoints` remains interactive, `/litellm-diagnostics <id>` does not degrade to overview, model `contextWindow/maxTokens > 0` for every registered model.

## 8. README

- [ ] 8.1 Rewrite `/litellm-endpoints` and `/litellm-diagnostics` sections to describe the seven user-visible statuses, the Retry action, and "why doesn't my endpoint appear in /models" guidance.
- [ ] 8.2 Audit every `json`/`jsonc` code block: only strict JSON for copy-paste; comment-bearing blocks stay `jsonc`. Current README's `jsonc` blocks already comply; re-verify after edits.

## 9. OpenSpec / closure

- [ ] 9.1 `openspec validate --all --strict --no-interactive` passes.
- [ ] 9.2 Update tasks checkboxes above to match reality before archive.

## 10. Cross-repo parity check

- [ ] 10.1 Confirm OpenCode-side change `improve-user-visible-state-consistency` implements the same status tokens and labels.
- [ ] 10.2 Confirm `litellm-discovery-core` requires no change (this change is adapter-only, per `AGENTS.md` 共享 core 边界).
