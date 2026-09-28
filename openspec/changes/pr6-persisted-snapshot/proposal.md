# PR6 persisted discovery snapshot adapter

Persist Core discovery snapshots through Pi's existing provider catalog store. Restore only endpoint-compatible snapshots, persist the new snapshot after successful discovery, and surface compatibility drift while keeping Pi lifecycle and storage ownership in the adapter.
