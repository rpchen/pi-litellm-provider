# Design

- Pi keeps using the host-owned `stored` / `publish` catalog channel; no plugin-private files are introduced.
- The persisted payload keeps the host-facing model list and adds Core's neutral discovery snapshot.
- When the host supplies a credential, restore is accepted only when Core validates the snapshot against the full endpoint fingerprint (normalized URL, credential, and result-affecting discovery options).
- Pi's restore-only phase may omit the resolved credential. The adapter therefore persists a second anonymous restore-scope fingerprint derived from normalized URL plus result-affecting options. In that phase the scope must match and Core still validates the stored snapshot's schema and model-fingerprint integrity; the next network phase performs the full credential-bound check.
- A URL, `contextTierCap`, or `protocolOverrides` change invalidates restore immediately. A credential change is rejected as soon as the host supplies the credential/network phase begins.
- Successful network discovery creates a new snapshot from the neutral `ModelSpec[]`.
- Compatibility drift is logged when a previous compatible snapshot differs in endpoint/model membership/protocol/capabilities.
- Persistence remains change-driven: unchanged models and unchanged snapshot identity do not rewrite the host store.
