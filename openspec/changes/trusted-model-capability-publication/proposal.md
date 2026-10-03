# Trusted model capability publication (Pi adapter)

## Why

Core change `trusted-model-capability-publication`
(rpchen/litellm-discovery-core PR #26) establishes the formal
publication loop: completeness policy, false-vs-unknown tri-states,
reasoning/levels decoupling, deterministic inheritance, failure
taxonomy, TTL-free LKG, explicit degradation, and provenance. Pi must
consume the same Core verdicts instead of reimplementing policy, and
must stop inferring reasoning support from variant count: a model that
reasons without selectable levels (for example toggle-style records
such as `glm-5.3`) is reasoning-capable with no level map, not a
non-reasoning model.

## What Changes

- Discovery consumes Core `buildPublicationResult`: only `configured`,
  `configured-lkg`, and user-accepted `degraded` models reach Pi
  registration; everything else stays visible in diagnostics with its
  status and gap list, never disguised as a normal model.
- Model mapping reads the Core `reasoningSupported` verdict for the Pi
  `reasoning` flag (legacy variant-count inference remains only for
  hand-built specs predating the field); `thinkingLevelMap` rules are
  unchanged, and support-without-levels maps to `reasoning: true` with
  no level map.
- The operational-limits guard (`contextWindow/maxTokens > 0`) stays as
  defense in depth behind the Core partition.
- Metadata fetch failures are classified with Core taxonomy and never
  produce pseudo-complete models; a per-endpoint LKG store (Core
  validity, no TTL) substitutes only provably belonging snapshots, and
  diagnostics shows live-vs-LKG selection with reasons.
- Diagnostics display publication states, missing/unknown/illegal
  fields, LKG selection, degraded acceptance, and field provenance.
- New command `litellm-accept-degraded <endpoint-id> <model-id>` records
  explicit user acceptance and refreshes; retry remains the existing
  force-refresh path with visible backoff state.
- References Core change `trusted-model-capability-publication`
  (rpchen/litellm-discovery-core PR #26); `dist/` refresh follows Core
  merge (one Core SHA per update build).

## Terminology

See the Core change for normal publication, `false` vs `unknown`, LKG,
and explicit degradation. Pi adds no new domain semantics: it maps Core
verdicts to provider registration and user-facing diagnostics/commands.

## Non-Goals

- Endpoint CRUD changes, polling/activation changes, price-precision
  work, per-model hardcodes, broadening publication counts.
