/**
 * Minimal host surface this extension depends on.
 *
 * Declared structurally (instead of importing `ExtensionAPI`) so the discovery core can be
 * unit-tested without the pi runtime present. The real factory in `./index.ts` satisfies it.
 */

export interface RefreshModelsContextLike {
  /** Abort signal owned by the refresh request; pass it to blocking I/O. */
  readonly signal?: AbortSignal
  /** Resolved credential; when present its key is preferred over any configured reference. */
  readonly credential?: { readonly type?: string; readonly key?: string }
  /** Persisted catalog snapshot from a previous successful refresh. */
  readonly stored?: { readonly models: readonly ProviderModelConfigLike[] }
  /** Whether this refresh phase may perform network access. */
  readonly allowNetwork?: boolean
  /** Whether the host asks to bypass freshness checks. */
  readonly force?: boolean
  /** Publish a persistence mutation for this provider's catalog. */
  readonly publish?: (publication: { persist?: unknown; update?: () => void }) => Promise<boolean>
}

export interface ProviderRegistration {
  readonly name: string
  readonly config: ProviderConfigLike
}

/**
 * Subset of pi's `ProviderConfig`.
 *
 * `api` ids are pi-ai's: `anthropic-messages`, `openai-completions`, `openai-responses`.
 */
export interface ProviderConfigLike {
  readonly name: string
  readonly baseUrl: string
  readonly apiKey: string
  readonly api?: string
  readonly models?: ProviderModelConfigLike[]
  readonly refreshModels?: (context: RefreshModelsContextLike) => Promise<ProviderModelConfigLike[]>
}

/** pi thinking levels; `null` in a map hides that level. */
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"

/** Subset of pi's `ProviderModelConfig`. */
export interface ProviderModelConfigLike {
  readonly id: string
  readonly name: string
  readonly api?: string
  readonly baseUrl?: string
  readonly reasoning: boolean
  readonly thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>
  readonly input: ("text" | "image")[]
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
