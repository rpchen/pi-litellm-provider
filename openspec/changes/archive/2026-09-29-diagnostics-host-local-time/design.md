# Design

- Discovery, cache and snapshot state keep their existing UTC ISO strings / epoch timestamps.
- Formatting is a Pi presentation concern; Core is unchanged.
- The formatter derives the current host offset from `Date#getTimezoneOffset()` at the instant being displayed, so the host's timezone/DST rules apply.
- Output uses a stable `YYYY-MM-DD HH:mm:ss UTC±HH:mm` form instead of locale-dependent text.
- Tests may inject an offset only to make CI deterministic; production callers omit it.
