# Tasks

## 1. Adapter integration

- [x] 1.1 Replace Pi-local model delta, publication merge, catalog miss and diagnostics merge implementations with Core #37 helpers.
- [x] 1.2 Reprocess only Core's degraded-catalog `metadata-unavailable` withheld candidates on same-set refresh; leave stable unmatched/invalid/incomplete models and normal registrations untouched.
- [x] 1.3 Rebuild `dist/` and provenance using only Core SHA `a08db4a70498ae7f397c264bb3f7c01eb196e1f8`.

## 2. Evidence and delivery

- [x] 2.1 Add adapter tests for temporary metadata recovery on the unchanged model set and stable unmatched non-retry.
- [x] 2.2 Run Pi full gates and Real Pi 0.87.1 E2E at immutable candidate `2c5b1d057f9c4485cca41cc2ae1976f02df49797`; CI run `38334901847` passed both CI and Real Pi 0.87.1 E2E. Local full Bun suite: 339 passed, 3 skipped; `verify:dist`, typecheck, package, release metadata, scenario coverage and strict spec validation passed.
- [x] 2.3 Archive this follow-up with the OpenSpec CLI, then rerun strict validation and OpenSpec closure.

### Scenario → test evidence

| Scenario | Test evidence |
|---|---|
| Temporary catalog failure recovers without a model-set change | `test/incremental-discovery.test.ts` — `uses model_name identity and demand-driven catalog refresh` |
| Stable unmatched identity does not retry | `test/incremental-discovery.test.ts` — same test's `stable-unmatched` assertions |
