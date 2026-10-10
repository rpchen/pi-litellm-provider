# Tasks

## 1. Regression coverage

- [x] 1.1 Add an endpoint-management regression test proving unchanged active Base URLs keep their registrations, changed Base URLs update only the affected provider, and explicit model refresh still runs; verify with `bun test test/endpoint-management.test.ts`.
- [x] 1.2 Run the fixture-backed discovery tests and full suite with `bun test` to ensure the adapter lifecycle fix does not change Core-to-Pi model mapping.

## 2. Adapter and release artifacts

- [x] 2.1 Make provider synchronization idempotent for unchanged normalized Base URLs; verify activation/deactivation and external Base URL edits remain covered by endpoint-management tests.
- [x] 2.2 Rebuild committed `dist/` with Core SHA `a13f16fd983478572502f3896fd5509978027261`; verify `bun run verify:dist` and provenance equality.
- [x] 2.3 Add a concise v0.10.0 release-note entry for recovery diagnostics reflecting the completed live refresh.

## 3. Integration and closure

- [x] 3.1 Run Real Pi 0.87.1 E2E against immutable candidate `b8b03567a9389057ed29b678ea8d87eb7d90f35a`; local E2E and exact-head GitHub job passed, including post-outage recovery diagnostics.
- [x] 3.2 Run typecheck, full tests, package isolation, OpenSpec scenario/closure/strict validation, release metadata, merge gate, and `git diff --check`; exact-head CI run [38025035469](https://github.com/rpchen/pi-litellm-provider/actions/runs/38025035469) passed all required jobs at `b8b03567a9389057ed29b678ea8d87eb7d90f35a`.
- [x] 3.3 Archived with `openspec archive stabilize-provider-refresh-registration --yes --json`; canonical endpoint-management spec updated and verified. Post-archive gates passed: strict validation (23/23), scenario coverage (44/44), closure (32 changes, 0 mismatches), release metadata, and merge gate.
