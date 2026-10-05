# Tasks

> Scenario coverage follows `litellm-discovery-core/docs/testing-standard.md`. Each `[TAG]` maps to a Scenario in `specs/endpoint-state-consistency/spec.md`; each tag has at least one piece of traceable automated evidence. Final state is recorded alongside each task.

## 1. Canonical endpoint state model (pure)

- [x] 1.1 Create `src/extension/endpoint-state.ts` implementing `EndpointState`, `UserVisibleStatus`, `userVisibleStatus(state)`, Chinese label maps, and `ApplyErrorCategory`. Pure, no Pi imports. → `src/extension/endpoint-state.ts`
- [x] 1.2 Unit tests `test/endpoint-state.test.ts` cover:
  - [STATE-DESIRED-ENABLED-INVALID] [STATE-DISABLED-INVALID] [STATE-ENABLED-NEEDS-AUTH] [STATE-ENABLED-NOT-APPLIED] [STATE-ENABLED-ERROR] [STATE-ENABLED-ACTIVE] [STATE-DISABLED]: `test/endpoint-state.test.ts` userVisibleStatus suite
  - [CRED-STORED-LABEL]: stored → "已保存 API Key", environment → "API Key 来自环境变量", none → "未保存 API Key", unknown → "凭据状态未知"; no label ever says "已连接"/"connected"
  - [CRED-MISSING-IS-NOT-INVALID]: none/unknown never map to invalid-configuration
  - [REGRESSION-MODELS-ZERO-LIMIT]: existing `map.ts` `hasOperationalLimits` kept; `test/endpoint-management.test.ts` continues to enforce

## 2. Registry keeps invalid endpoints

- [x] 2.1 `loadEndpointRegistry` keeps invalid `baseUrl` entries with `validation.kind = "invalid"` (drops only id-pattern or shape violations that are unusable even for diagnostics). → `src/extension/config.ts`
- [x] 2.2 Tests: `test/config.test.ts` [VALIDATION-INVALID-PRESERVED] + [VALIDATION-CONSISTENCY].

## 3. Applied state tracking in the adapter

- [x] 3.1 `endpointStates: Map<string, EndpointState>` in `src/extension/index.ts`; `setApplied(endpointId, ...)` writes process-local state (and only ever overwrites `applied`; desired / validation / credential are recomputed from persisted truth on every read via `endpointStateFor`).
- [x] 3.2 `refreshModels` categorises terminal outcomes into `applied.kind = active | error(category)`. Cancellation never overwrites a terminal state.
- [x] 3.3 Apply-failure never rewrites persisted activation ([DESIRED-PERSISTED-ENABLED] / [DESIRED-NO-SILENT-ROLLBACK]); `host.persistActivation` is never called from the refresh path. Indirectly locked by `test/endpoint-management.test.ts` and `test/extension.test.ts`.
- [x] 3.4 Integration tests cover the transitions in `test/extension.test.ts` + `test/endpoint-management.test.ts`.

## 4. `/models` strict semantics

- [x] 4.1 `refreshModels` returns the endpoint's actual applied models when `desired=enabled ∧ validation=ok ∧ credential∈{stored, environment}`; otherwise returns `[]` so the host drops them. Pi's host is the source of truth for `/models` — gating lives in the refresh / unregister decision.
- [x] 4.2 Deactivate → `pi.unregisterProvider` + `applied=not-applied`; the next `refreshModels` for that provider is unreachable ([MODELS-HIDE-DISABLED]).
- [x] 4.3 Apply-failed endpoints keep `applied.kind="error"`; `/litellm-diagnostics` shows the category and reason ([MODELS-HIDE-UNAPPLIED]).
- [x] 4.4 Invalid endpoints are never registered with Pi; even if `refreshModels` were called, `mapProvider` rejects them via `validation !== "ok"` ([MODELS-HIDE-INVALID]).
- [x] 4.5 Snapshot restore is gated by `canRestoreSnapshot(state)` ([MODELS-SNAPSHOT-GATE]): persisted snapshots never bypass the four dimensions.
- [x] 4.6 Integration tests: `test/endpoint-management.test.ts` [INVALID-VISIBLE] / [INVALID-ENABLED]; `test/endpoint-state.test.ts` canPublish / canRestoreSnapshot.

## 5. Management UI (Pi)

- [x] 5.1 `endpoint-management.ts` views derive user-visible labels from `userVisibleStatus(state)` for the canonical state from `host.endpointState(id)`. Single source of truth.
- [x] 5.2 Credential labels replaced everywhere (list row, detail title, Add/Connect notices) with `已保存 API Key` / `API Key 来自环境变量` / `未保存 API Key` / `凭据状态未知`. "已连接"/"connected" never appear as a credential state.
- [x] 5.3 Endpoint detail exposes **重新应用** (`canRetry(state)`) only for `enabled` + `validation=ok` + `credential∈{stored,env}` + `applied.kind ∈ {not-applied, error}`. Disabled and invalid endpoints never see it ([RETRY-NO-OP-FOR-DISABLED]).
- [x] 5.4 Apply failure surfaces honestly via the derived "已启用 · 出错" / "已启用 · 未生效" labels; Add/Edit flows already reported correctly.
- [x] 5.5 Tests under `test/endpoint-management.test.ts`: [CONSISTENCY-ALL-VIEWS] across list row ↔ detail title ↔ diagnostics; [INVALID-VISIBLE], [INVALID-ENABLED], [STATE-ENABLED-NEEDS-AUTH].

## 6. Diagnostics command

- [x] 6.1 `/litellm-diagnostics <id>` prints a complete per-endpoint record for any state — disabled, invalid, needs-auth, not-applied, error, active. Never degrades to "未激活 · models=0" placeholder ([DIAG-DETAIL-DISABLED] / [DIAG-DETAIL-INVALID] / [DIAG-DETAIL-NEEDS-AUTH]).
- [x] 6.2 No-arg overview lists every configured endpoint with `✓/○`, provider id, user-visible status, and `models=N`.
- [x] 6.3 Diagnostics output excludes URL, API key, raw error bodies (regression locked by existing diagnostics tests).

## 7. Real Pi E2E (gate per AGENTS.md §13)

- [x] 7.1 `scripts/e2e-real-pi.mjs` updated: Pi 0.87.1 Real E2E passes against the staged Git commit. Asserts the new labels `已启用 · 已生效 · 已保存 API Key`, `未启用 · 未保存 API Key`, `已启用 · 需要认证 · 未保存 API Key`; covers Scenarios A, B, C, D, E, F via existing management / legacy / deactivate-delete flows. New state model verified across the real host: disabled → enable → apply success → models appear; deactivate → models disappear; invalid endpoint never registers; credential missing blocks publishing without being marked invalid.

## 8. README

- [x] 8.1 Sections `/litellm-endpoints` and `/litellm-diagnostics` rewritten with the four-dimension model and seven user-visible statuses. New "我的 endpoint 为什么没出现在 /models" guidance with per-status next steps. Retry / 重新应用 added to the operations table.
- [x] 8.2 JSON/JSONC code blocks audited: every copy-pasteable JSON block remains strict JSON; comment-bearing blocks remain labelled `jsonc`.

## 9. OpenSpec / closure

- [x] 9.1 `openspec validate --all --strict --no-interactive` passes.
- [x] 9.2 All `[x]` reflect actual state; closure evidence assembled in this PR.

## 10. Cross-repo parity check

- [x] 10.1 OpenCode PR carries the same status tokens and 中文 labels; both adapters produce the same seven user-visible statuses.
- [x] 10.2 `litellm-discovery-core` unchanged: this change is adapter-only.

