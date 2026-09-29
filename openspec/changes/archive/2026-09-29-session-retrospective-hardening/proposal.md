# Session retrospective hardening

## Why

The PR8 follow-up and v0.3.0 release exposed repeatable gaps that must not depend on conversational memory: a neutral zero-limit model can become an unusable Pi model, completed OpenSpec changes can remain active, and README release examples can drift from package/tag versions.

## What Changes

- Reject non-operational Core ModelSpecs at the Pi host-publication boundary.
- Add CI gates for completed-but-unarchived OpenSpec changes and release metadata consistency.
- Correct the README current-release example.
- Record the superseding discovery/release decisions in repository guidance.
