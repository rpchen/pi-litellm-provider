# Design

- Pi continues to treat Core `ModelSpec` as the discovery authority.
- `toProviderModels` maps Core `limit.context` to Pi `contextWindow` and `limit.output` to `maxTokens`; it does not recompute limits.
- The integration test uses the real shared fixture so an incorrect Core-to-Pi mapping fails independently of Core-only snapshots.
- The committed distribution must record the merged PR8 Core SHA.
