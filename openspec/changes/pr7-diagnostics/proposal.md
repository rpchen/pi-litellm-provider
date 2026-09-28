# PR7 Pi diagnostics adapter

Expose the shared Core discovery diagnostics through Pi without changing discovery behavior. The adapter keeps a safe per-provider diagnostic snapshot across restore/network refreshes and registers a user-invokable /litellm-diagnostics command using Pi's native command/UI APIs.
