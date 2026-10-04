# Design (Pi adapter)

## Architecture

- `src/extension/map.ts` gains `toProviderModelsWithPublication`:
  input is Core `PublishableEntry[]` (spec + live assessment +
  optional degraded wrapper). Mapping per entry:
  - operational-limits guard retained (Core already partitions; the
    guard stays as adapter-side defense in depth, covered by the
    existing generalized test);
  - `reasoning` flag from `spec.reasoningSupported` when present
    (`"supported"` → true, else false), falling back to
    `variants.length > 0` only for legacy specs without the field;
  - `thinkingLevelMap` via the unchanged `thinkingLevelMapFor`;
  - degraded entries map to the same provider shape (conservative
    flags); degraded visibility comes from diagnostics, which lists
    degraded ids with their remaining gaps.
- `src/extension/discovery.ts`:
  - `discoverModels` accepts optional `publicationOptions: { store,
    acceptedDegradedIDs, now }` and returns the outcome plus a
    `publication` summary (publishable ids with states, blocked ids
    with status/gaps, LKG usage). On models.dev fetch failure it passes
    an empty catalog with the Core-classified failure into
    `buildPublicationResult` instead of throwing away the whole
    discovery: valid LKG entries yield `configured-lkg` models, the
    rest stay blocked with reasons. LiteLLM fetch failures keep the
    existing coordinator-stale behavior (outcome-level last good).
  - Per-endpoint LKG stores live in a module-level `WeakMap` keyed by
    the provider refresh coordinator (one coordinator per provider
    instance preserves endpoint isolation); successful `configured`
    discoveries seed entries via `createLastKnownGoodEntry`.
  - `refreshProviderModels` threads an optional
    `PublicationController` (accepted-degraded set + store) defaulting
    to the coordinator-scoped instance, so the accept-degraded command
    and refresh share state without touching persisted shapes.
- `src/extension/diagnostics.ts`: `ProviderDiagnosticSnapshot` gains an
  optional `publication` summary; `formatProviderDiagnostics` renders
  blocked models with status/gaps, degraded ids, LKG usage with age,
  and next-retry info (already present via cache diagnostics).
- `src/extension/index.ts`: new `litellm-accept-degraded` command
  (`<endpoint-id> <model-id>`): validates endpoint + blocked-model
  membership from diagnostics state, records acceptance, triggers a
  forced refresh for that provider, and notifies the remaining gaps.
  No activation, polling, credential, or endpoint-config changes.

## Alternatives considered

- Reimplementing completeness checks in the adapter: rejected, Core is
  the single source of truth.
- Persisting degraded acceptance in the host catalog: rejected for this
  phase; acceptance lives in coordinator-scoped memory and is reported
  in diagnostics. Restart requires re-acceptance, which is the safe
  default for degraded exposure.
- Blocking registration on unknown protocol support: rejected, same as
  Core (chat fallback is the safe default).
