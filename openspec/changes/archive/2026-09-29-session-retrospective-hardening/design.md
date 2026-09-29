# Design

- Core may keep unknown-limit models for diagnostics; Pi maps only ModelSpecs with positive context and output limits into ProviderModelConfig.
- The Pi adapter uses the shared Core operational-limit predicate rather than maintaining a separate rule.
- CI runs strict OpenSpec validation, an active-change closure check, and release metadata consistency.
- Release metadata consistency covers package.json, package-lock root versions, and README current-release install example.
