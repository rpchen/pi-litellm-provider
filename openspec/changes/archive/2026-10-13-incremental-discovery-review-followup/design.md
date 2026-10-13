# Design

## Context

Core #37 is merged at `a08db4a70498ae7f397c264bb3f7c01eb196e1f8` and exports shared model delta, publication merge, diagnostics merge, catalog-miss and temporary metadata failure candidate helpers. Pi owns request timing, cache I/O, LKG store, host persistence and provider mapping only.

## Decisions

- Pi supplies the previous successful Core result to `temporaryMetadataFailureModelNames`; the returned names are unioned with new names as the only processed subset.
- Prior configured models remain in the retained subset and are not re-matched or re-downloaded.
- A same-set refresh retries only withheld `metadata-unavailable` models when prior diagnostics say the models.dev catalog was degraded. Stable `unmatched`, `invalid-metadata` and `discovered-incomplete` results are not retried.
- Existing LKG store, publication gate, cancellation, error classification, cache retry policy and endpoint scope remain unchanged.
- All delta/merge algorithms come from Core; Pi retains only lifecycle and host mapping.

## Evidence

The adapter test injects a failed latest catalog fetch for an added model, then a successful catalog on the next same-set refresh. It also changes the catalog after a complete-catalog unmatched result and proves there is no follow-up catalog request for that stable identity.
