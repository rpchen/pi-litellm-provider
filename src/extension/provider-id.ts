import { DEFAULT_ENDPOINT_ID } from "./config.ts"

export const PROVIDER_ID = "litellm"

export function providerIdForEndpoint(endpointId: string): string {
  return endpointId === DEFAULT_ENDPOINT_ID ? PROVIDER_ID : `${PROVIDER_ID}-${endpointId}`
}

export function providerNameForEndpoint(endpointId: string): string {
  return endpointId === DEFAULT_ENDPOINT_ID ? "LiteLLM" : `LiteLLM · ${endpointId}`
}
