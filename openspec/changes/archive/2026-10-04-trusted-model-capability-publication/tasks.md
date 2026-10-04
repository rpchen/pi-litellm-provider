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
- [x] Align Core-copy fixtures/tests with group-wide limit/modality/identity evidence (Core branch head `8afc3e7d7a7b98581626fedb0322099ad3933cce`).
- [x] Extend Real Pi 0.87.1 E2E fixtures/assertions for the publication boundary (incomplete model never registered, diagnostics names it and its gaps).
- [x] `bun run build:dist` to the merged Core SHA + `bun run verify:dist` and `bun run test:package` (Core #26 merged as `649bc84fff85488a5fc6bda0c2a2a9504a357db4`; local `verify:dist`, `typecheck`, `bun test` 341 pass / 3 skip, `test:package`, `validate:spec`, scenario coverage, closure gate, release metadata and `test:codebase-memory` all green).
- [x] Real Pi 0.87.1 E2E run against the committed dist at Core `649bc84fff85488a5fc6bda0c2a2a9504a357db4` (GitHub PR #45 head `08875ac3f3d3f734f8654fd6c7868f4d750a67f7`: `CI` SUCCESS + `Real Pi 0.87.1 E2E` SUCCESS; local run against the same immutable Git commit also green, covering the publication partition, toggle reasoning, LKG substitution, degraded accept/reject and metadata-failure diagnostics).
- [x] Archive the change with OpenSpec CLI and re-run strict validation (dist refreshed to merged Core `649bc84fff85488a5fc6bda0c2a2a9504a357db4`, PR #45 CI + Real Pi 0.87.1 E2E green).