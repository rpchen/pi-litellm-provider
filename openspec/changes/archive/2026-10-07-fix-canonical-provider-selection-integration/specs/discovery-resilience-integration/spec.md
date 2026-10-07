# Delta: discovery-resilience-integration

## MODIFIED Requirements

### Requirement: Adapter consumes Core publication facts without re-deriving policy
The extension SHALL consume Core's publication partition, catalog facts, withheld reasons, evidence resolutions, and acknowledgement decision verbatim, and SHALL NOT re-derive completeness, conflict, eligibility, or authority judgments locally. The extension SHALL preserve Core's provider-selection provenance (`selectionSource`) through to diagnostics so a wrong configuration can be attributed to identity resolution, provider evidence, or fallback choice.

#### Scenario: Conflict-blocked groups stay blocked
- **WHEN** Core reports a model withheld for an unresolved conflict (limits disagree or identities cannot be proven equal)
- **THEN** the model stays unregistered with status and conflict fields visible in diagnostics

#### Scenario: Published set is exactly Core's publishable set
- **WHEN** diagnostics are displayed
- **THEN** the registered model ids equal Core's `publishable` ids, and every other discovered model is listed as withheld with its reason codes

#### Scenario: Provider selection provenance is preserved
- **WHEN** Core resolves a model's metadata provider and selection source (for example provider `deepseek`, source `canonical-original`, or provider `opencode`, source `opencode-fallback`)
- **THEN** Pi diagnostics expose the Core selection source without re-deriving it, and the registered model's limits equal the Core spec's limits verbatim (`contextWindow = spec.limit.context`, `maxTokens = spec.limit.output`)