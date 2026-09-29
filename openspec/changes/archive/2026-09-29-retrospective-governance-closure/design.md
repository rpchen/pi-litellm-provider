# Design

- Keep runtime/model behavior unchanged; this change only strengthens repository governance.
- `check-openspec-closure.mjs` scans active OpenSpec changes and fails when a tasks file has completed items and no unchecked items.
- `check-release-metadata.mjs` compares package.json, both package-lock root version fields, and the README fixed-version install example.
- CI and Release execute both checks in addition to strict OpenSpec validation.
