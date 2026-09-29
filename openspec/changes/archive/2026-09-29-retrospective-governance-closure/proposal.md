# Retrospective governance closure

## Why

The PR8 follow-up showed that durable rules are not enough when repository state can still drift: completed OpenSpec changes may remain active, and package/lockfile versions can diverge from the README fixed-version example. The earlier broad retrospective PR was superseded by focused runtime/release PRs, so the missing governance gates must be reapplied cleanly on current main.

## What Changes

- Reject completed-but-unarchived OpenSpec changes in CI and Release.
- Verify package.json, package-lock root versions, and the README current-release fixed tag stay aligned.
- Record the release/session retrospective rules in maintainer guidance.
- No runtime or user-visible behavior changes.
