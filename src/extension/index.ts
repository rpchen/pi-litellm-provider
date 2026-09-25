import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { toProviderModels } from "./map.ts"
import type { ProviderConfigLike } from "./types.ts"

/** Provider id shown in pi's model picker. */
export const PROVIDER_ID = "litellm"

/**
 * Pi extension factory.
 *
 * Registering here (rather than from `session_start`) makes the provider available to
 * startup model selection and `pi --list-models`, per pi's Custom Providers guidance.
 */
export default function piLitellmProvider(pi: ExtensionAPI): void {
  const config: ProviderConfigLike = {
    name: "LiteLLM",
    // TODO(auth): resolve from the user's stored LiteLLM connection, not a literal.
    baseUrl: "",
    apiKey: "",
    refreshModels: async (context) => {
      void context.signal
      return toProviderModels()
    },
  }

  pi.registerProvider(PROVIDER_ID, config as Parameters<ExtensionAPI["registerProvider"]>[1])
}
