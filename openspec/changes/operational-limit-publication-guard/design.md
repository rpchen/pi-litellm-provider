# Design

- Core remains free to represent unknown limits as zero for neutral discovery and diagnostics.
- Pi owns the publication boundary and filters ModelSpec entries unless both context and output are positive.
- The guard is generic and model-agnostic; it is not a special case for hy4-preview or any provider.
- Diagnostics remain based on Core discovery state, so omitted host models can still be explained.
- README fixed-version examples must track the latest published stable tag.
