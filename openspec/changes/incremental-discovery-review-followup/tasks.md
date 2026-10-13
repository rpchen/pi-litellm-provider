# Tasks

## 1. Adapter integration

- [x] 1.1 Replace Pi-local model delta, publication merge, catalog miss and diagnostics merge implementations with Core #37 helpers.
- [x] 1.2 Reprocess only Core's degraded-catalog `metadata-unavailable` withheld candidates on same-set refresh; leave stable unmatched/invalid/incomplete models and normal registrations untouched.
- [x] 1.3 Rebuild `dist/` and provenance using only Core SHA `a08db4a70498ae7f397c264bb3f7c01eb196e1f8`.

## 2. Evidence and delivery

- [x] 2.1 Add adapter tests for temporary metadata recovery on the unchanged model set and stable unmatched non-retry.
- [ ] 2.2 Run Pi full gates and Real Pi 0.87.1 E2E at the final immutable candidate commit; record CI evidence.
- [ ] 2.3 Strict-validate and archive this follow-up change after adapter CI/E2E passes; rerun OpenSpec closure.

### Scenario → test evidence

| Scenario | Test evidence |
|---|---|
| Temporary catalog failure recovers without a model-set change | `test/incremental-discovery.test.ts` — `uses model_name identity and demand-driven catalog refresh` |
| Stable unmatched identity does not retry | `test/incremental-discovery.test.ts` — same test's `stable-unmatched` assertions |
