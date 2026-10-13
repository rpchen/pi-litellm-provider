# Proposal

## Why

Core #37 centralizes incremental model-name processing. Two adapter Review issues remain: temporary catalog failure can leave an unchanged model set permanently withheld, and adapters must consume the new Core helpers rather than maintain local copies. OpenCode's real-host E2E must exercise catalog outage, existing LKG use and recovery under model-name-triggered refreshes.

## What Changes

1. Replace Pi-local model delta, publication merge, catalog-miss and diagnostics merge functions with Core #37's public helpers.
2. Reprocess only previously withheld `metadata-unavailable` model names when the prior Core diagnostics say the models.dev catalog was degraded. Keep normally registered models reused; do not automatically retry stable unmatched/invalid/incomplete models.
3. Add Pi adapter regression tests for same-set temporary metadata failure recovery and stable unmatched non-retry.

## Capabilities

### Modified Capabilities

| Capability | Adjustment |
|---|---|
| model-discovery | Reuse Core incremental semantics and recover only transient catalog-withheld models |
| discovery-resilience-integration | Preserve existing LKG/degraded failure behavior during incremental refresh |

## Impact

Depends on Core PR #37 merged SHA `a08db4a70498ae7f397c264bb3f7c01eb196e1f8`. Rebuild Pi `dist/` and provenance from that exact Core SHA. No new command, UI, configuration, retry state or runtime dependency.
