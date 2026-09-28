# Design

- The Pi adapter owns diagnostic lifecycle state because cache source, restore status, credentials/configuration failures and user presentation are host concerns.
- Network discovery uses Core diagnoseModelSpecs so the registered models and the explained models come from one builder.
- Restore diagnostics identify endpoint-compatible persisted snapshots but do not invent models.dev/protocol provenance that cannot be reconstructed from the neutral snapshot alone.
- /litellm-diagnostics renders a compact Chinese status through ctx.ui.notify and never sends a chat turn or consumes model tokens.
- Build information is read from the shipped package.json and dist/core-provenance.json. The formatter never includes endpoint URLs, credentials, connection identity or raw transport error text.
