# Design

## Context

See `proposal.md` for the recovery-diagnostics failure. In Pi 0.87.1, `registerProvider` replaces the provider and starts an asynchronous refresh with `allowNetwork: false`. The endpoint manager separately awaits `modelRegistry.refresh({ force: true })`. Replacing an unchanged provider during this sequence can supersede the live refresh while Pi reloads its model configuration.

The extension's host-visible registration fields are derived from the endpoint ID and normalized Base URL. Discovery settings and endpoint data are read by the registered refresh callback, so they do not require replacing a provider when its Base URL is unchanged.

## Goals / Non-Goals

**Goals:**

- Keep the existing registration for active endpoints when the normalized Base URL is unchanged.
- Preserve explicit model refresh behavior and apply changed Base URLs immediately.
- Keep the fix within the Pi adapter; discovery semantics remain owned by Core.

**Non-Goals:**

- Change refresh cadence, diagnostics status semantics, Core APIs, publication policy, or endpoint activation behavior.
- Add retries or relax the Real Pi E2E gate.

## Decisions

- Track the normalized Base URL used at registration for each active endpoint. Call `registerProvider` only for a newly active endpoint or when that Base URL changes; remove the tracked value when the endpoint is unregistered.
- Continue the endpoint manager's explicit `modelRegistry.refresh` call after activation and refresh commands. This remains the path that performs network discovery and updates diagnostics.
- Do not debounce or await Pi's registration-triggered refresh: the host API exposes no completion handle for it. Avoiding unnecessary replacement removes the competing restore-only refresh on the unchanged endpoint path.
- Keep `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` peer dependencies at the existing declared range `*`; validate the real-host behavior on the required Pi 0.87.1 version.
- Keep Core unchanged at `a13f16fd983478572502f3896fd5509978027261`; rebuild committed `dist/` from that provenance.

## Risks / Trade-offs

- If a future provider registration adds a host-visible field that is not derived from the endpoint ID or Base URL, the comparison must include it; otherwise a changed value could remain unapplied. The current registration's other static fields are constant or endpoint-ID-derived.
- A changed Base URL still causes Pi's restore-only refresh before the explicit network refresh. The current E2E recovery path uses unchanged Base URLs; the explicit refresh remains awaited and applies edits as before.

## Migration Plan

No user configuration or persisted data migration is needed. Rebuild and verify `dist/` using the existing Core SHA, then run the complete local and Real Pi 0.87.1 gates against the immutable candidate commit.
