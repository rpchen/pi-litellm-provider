# Design

- Each registered Pi provider config owns one shared Core coordinator instance.
- Pi's `refreshModels` restore phase remains host-owned and never performs network work.
- Network discovery is keyed by LiteLLM address plus the resolved credential so distinct access scopes do not share cached catalogs.
- `context.force` maps to Core `forceRefresh`.
- Host cancellation is classified as `ignore`, authentication/configuration failures as `clear`, and degradable transport/server/parse failures as `stale`.
- Persisted model-store behavior remains unchanged: only changed model lists are published.
- The existing session poll timer remains a Pi adapter concern; Core does not own timers.
