/** Legacy provider id preserved for the explicit endpoint named "default". */
export const PROVIDER_ID = "litellm"

/** Stable Pi provider identity derived only from the immutable endpoint ID. */
export function providerIDForEndpoint(endpointID: string): string {
  return endpointID === "default" ? PROVIDER_ID : `${PROVIDER_ID}-${endpointID}`
}

export function providerDisplayName(endpointID: string, explicitMulti: boolean): string {
  return explicitMulti ? `LiteLLM · ${endpointID}` : "LiteLLM"
}
