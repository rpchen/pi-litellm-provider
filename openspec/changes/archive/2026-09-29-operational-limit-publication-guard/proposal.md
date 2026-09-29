# Operational limit publication guard

Prevent Pi from registering discovered models whose final Core metadata still lacks usable context or output token limits. Core may retain such models for diagnostics, but the host must not publish a configuration that is operationally unusable.
