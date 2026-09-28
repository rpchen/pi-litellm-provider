# Design

- Pi keeps using the host-owned `stored` / `publish` catalog channel; no plugin-private files are introduced.
- The persisted payload keeps the host-facing model list and adds Core's neutral discovery snapshot.
- Restore is accepted only when Core validates the snapshot against the current normalized endpoint, credential, and result-affecting discovery options.
- A credential, URL, `contextTierCap`, or `protocolOverrides` change invalidates the old snapshot.
- Successful network discovery creates a new snapshot from the neutral `ModelSpec[]`.
- Compatibility drift is logged when a previous compatible snapshot differs in endpoint/model membership/protocol/capabilities.
- Persistence remains change-driven: unchanged models and unchanged snapshot identity do not rewrite the host store.
