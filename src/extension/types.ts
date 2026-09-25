/**
 * Minimal host surface this extension depends on.
 *
 * Declared structurally (instead of importing `ExtensionAPI`) so the discovery core can be
 * unit-tested without the pi runtime present. The real factory in `./index.ts` satisfies it.
 */

export interface RefreshModelsContextLike {
  /** Abort signal owned by the refresh request; pass it to blocking I/O. */
  readonly signal?: AbortSignal
}

export interface ProviderRegistration {
  readonly name: string
  readonly config: ProviderConfigLike
}

/**
 * Subset of pi's `ProviderConfig`.
 *
 * `models` is intentionally omitted: `refreshModels` supplies the live catalog.
 * `api` ids are pi-ai's: `anthropic-messages`, `openai-completions`, `openai-responses`.
 */
export interface ProviderConfigLike {
  readonly name: string
  readonly baseUrl: string
  readonly apiKey: string
  readonly refreshModels?: (context: RefreshModelsContextLike) => Promise<ProviderModelConfigLike[]>
}

/** Subset of pi's `ProviderModelConfig`. */
export interface ProviderModelConfigLike {
  readonly id: string
  readonly name: string
  readonly api?: string
  readonly reasoning: boolean
  readonly input: readonly ("text" | "image")[]
  readonly cost: {
    readonly input: number
    readonly output: number
    readonly cacheRead: number
    readonly cacheWrite: number
  }
  readonly contextWindow: number
  readonly maxTokens: number
}

/** The extension-facing slice of pi's `ExtensionAPI` used today. */
export interface HostApiLike {
  registerProvider(name: string, config: ProviderConfigLike): void
  unregisterProvider(name: string): void
}
