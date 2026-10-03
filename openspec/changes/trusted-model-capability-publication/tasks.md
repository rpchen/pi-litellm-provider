# Tasks (Pi adapter)

- [ ] Map `reasoning` from the Core `reasoningSupported` verdict; keep variant-count inference only as legacy fallback.
- [ ] Consume Core `buildPublicationResult` in discovery (publish only configured / configured-lkg / accepted-degraded).
- [ ] Classify models.dev failures with Core taxonomy; substitute valid LKG via per-endpoint stores (no TTL).
- [ ] Seed LKG entries on successful configured discoveries.
- [ ] Surface publication states, gaps, LKG selection, degraded acceptance, and provenance in diagnostics display.
- [ ] Add `litellm-accept-degraded <endpoint-id> <model-id>` command with forced refresh.
- [ ] Add adapter tests: Core-to-mapping (reasoning verdict incl. toggle/no-levels), partition (blocked never registered), failure/LKG substitution, degraded acceptance longitudinal (Core -> Pi state -> command/UI).
- [ ] Add MODIFIED spec deltas for the stale family-modality exception and toggle-reasoning-false rule.
- [ ] Update README for the new command and the degraded/LKG diagnostics concepts.
- [ ] Run `bun run verify:dist`, `bun run typecheck`, `bun test`, `bun run test:package`, `npm run validate:spec`.
- [ ] Run Real Pi 0.87.1 E2E (requires Core PR merge + `build:dist` refresh to the merged SHA first).
- [ ] Archive the change with OpenSpec CLI and re-run strict validation.
