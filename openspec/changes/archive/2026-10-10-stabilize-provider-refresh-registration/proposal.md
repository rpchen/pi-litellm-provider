# Proposal

## Why

Pi starts a restore-only model refresh when an extension provider is registered. Re-registering unchanged providers during `/litellm-endpoints all` can supersede the explicit network refresh, leaving recovery diagnostics at “waiting for network confirmation” after the endpoint is back online.

## What Changes

- Preserve active provider registrations while their host-visible Base URL is unchanged.
- Continue to run the explicit model refresh for active endpoints; re-register the affected provider when its Base URL changes.
- Add a regression test for repeated refresh, selective registration updates, and live outage recovery through Real Pi 0.87.1 E2E.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `endpoint-management`: stable endpoint refreshes preserve provider registration while Base URL changes are applied immediately.

## Impact

- Affected files: `src/extension/index.ts`, endpoint-management tests, `dist/`, and the v0.10.0 release notes.
- Pi host APIs: `ExtensionAPI.registerProvider` and `ExtensionContext.modelRegistry.refresh`; the package keeps its existing `*` peer dependency declarations and the real-host gate uses Pi 0.87.1.
- Core ownership: no discovery or model-semantic changes; the embedded Core remains fixed at `a13f16fd983478572502f3896fd5509978027261`.
