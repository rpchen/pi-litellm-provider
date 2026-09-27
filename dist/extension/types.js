/**
 * Minimal host surface this extension depends on.
 *
 * Declared structurally (instead of importing `ExtensionAPI`) so the discovery core can be
 * unit-tested without the pi runtime present. The real factory in `./index.ts` satisfies it.
 */
export {};
