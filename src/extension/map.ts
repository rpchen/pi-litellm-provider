import type { ProviderModelConfigLike } from "./types.ts"

/**
 * Translation seam between the host-independent discovery core and pi's provider config.
 *
 * The core (shared with ../opencode-litellm-provider) produces host-neutral model specs.
 * This module owns the only host-specific mapping: which pi-ai API implementation each
 * LiteLLM protocol uses.
 *
 * Until the shared core is wired in, this file only pins the contract.
 */

/** LiteLLM protocol -> pi-ai API id. */
export const PROTOCOL_API: Readonly<Record<"chat" | "responses" | "messages", string>> = {
  chat: "openai-completions",
  responses: "openai-responses",
  messages: "anthropic-messages",
}

/**
 * TODO(core): replace with the real mapping once the shared core lands.
 *
 * Expected input is the core's `ModelSpec` (id, name, protocol, capabilities, cost, limit,
 * variants). `variants` has no pi equivalent yet: pi uses `thinkingLevelMap`, so reasoning
 * variants must be translated there or dropped with a written rationale.
 */
export function toProviderModels(): ProviderModelConfigLike[] {
  return []
}
