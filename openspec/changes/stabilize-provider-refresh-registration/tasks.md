# Tasks

## 1. Regression coverage

- [ ] 1.1 Add an endpoint-management regression test proving unchanged active Base URLs keep their registrations, changed Base URLs update only the affected provider, and explicit model refresh still runs; verify with `bun test test/endpoint-management.test.ts`.
- [ ] 1.2 Run the fixture-backed discovery tests and full suite with `bun test` to ensure the adapter lifecycle fix does not change Core-to-Pi model mapping.

## 2. Adapter and release artifacts

- [ ] 2.1 Make provider synchronization idempotent for unchanged normalized Base URLs; verify activation/deactivation and external Base URL edits remain covered by endpoint-management tests.
- [ ] 2.2 Rebuild committed `dist/` with Core SHA `a13f16fd983478572502f3896fd5509978027261`; verify `bun run verify:dist` and provenance equality.
- [ ] 2.3 Add a concise v0.10.0 release-note entry for recovery diagnostics reflecting the completed live refresh.

## 3. Integration and closure

- [ ] 3.1 Run Real Pi 0.87.1 E2E against an immutable candidate Git commit and verify post-outage recovery diagnostics return to the live publication result.
- [ ] 3.2 Run typecheck, full tests, package isolation, OpenSpec scenario/closure/strict validation, release metadata, merge gate, and `git diff --check`; record results in this task.
- [ ] 3.3 Archive this change with the OpenSpec CLI after all required gates pass; verify canonical specs and `openspec validate --all --strict --no-interactive`.
