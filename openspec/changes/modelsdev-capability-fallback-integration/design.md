# Design

- Pi continues to consume Core ModelSpec without reimplementing provider selection.
- Core chooses the enrichment record; Pi maps Core context/output limits directly to contextWindow/maxTokens.
- A vertical regression test uses hy4-preview with OpenRouter and OpenCode records and asserts the Pi model has positive operational limits.
- Explicit LiteLLM price metadata remains visible after capability fallback.
