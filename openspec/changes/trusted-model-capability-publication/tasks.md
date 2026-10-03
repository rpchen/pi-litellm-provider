# Tasks (Pi adapter)

- [x] Map `reasoning` from the Core `reasoningSupported` verdict; keep variant-count inference only as legacy fallback.
- [x] Consume Core `buildPublicationResult` in discovery (publish only configured / configured-lkg / accepted-degraded).
- [x] Classify models.dev failures with Core taxonomy; substitute valid LKG via per-endpoint stores (no TTL).
- [x] Seed LKG entries on successful configured discoveries.
- [x] Surface publication states, gaps, LKG selection, degraded acceptance, and provenance in diagnostics display.
- [x] Add `litellm-accept-degraded <endpoint-id> <model-id>` command with forced refresh.
- [x] Add adapter tests: Core-to-mapping (reasoning verdict incl. toggle/no-levels), partition (blocked never registered), failure/LKG substitution, degraded acceptance longitudinal (Core -> Pi state -> command/UI).
- [x] Add MODIFIED spec deltas for the stale family-modality exception and toggle-reasoning-false rule.
- [x] Update README for the new command and the degraded/LKG diagnostics concepts.
- [x] Consume Core degradation eligibility in `/litellm-accept-degraded`; reject ineligible statuses without a success message.
- [x] Seed LKG with the Core captured publication verdict.
- [x] Source-level typecheck and unit tests against reviewed Core head `1cd6bc285cdf692c335d3fd401a4e4436eb515ef`.
- [x] Align Core-copy fixtures/tests with group-wide limit/modality/identity evidence (Core branch head `e71393d5c503272b663ecc1ef237a23198b46916`).
- [x] Extend Real Pi 0.87.1 E2E fixtures/assertions for the publication boundary (incomplete model never registered, diagnostics names it and its gaps).
- [ ] `bun run build:dist` to the merged Core SHA + `bun run verify:dist` and `bun run test:package` (blocked until rpchen/litellm-discovery-core#26 merges).
- [ ] Real Pi 0.87.1 E2E run (blocked: it installs a committed dist, so it must run after the Core merge + dist refresh).
- [ ] Archive the change with OpenSpec CLI and re-run strict validation (blocked on the same merge order).