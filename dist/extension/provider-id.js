import { DEFAULT_ENDPOINT_ID } from "./config.js";
export const PROVIDER_ID = "litellm";
export function providerIdForEndpoint(endpointId) {
    return endpointId === DEFAULT_ENDPOINT_ID ? PROVIDER_ID : `${PROVIDER_ID}-${endpointId}`;
}
export function providerNameForEndpoint(endpointId) {
    return endpointId === DEFAULT_ENDPOINT_ID ? "LiteLLM" : `LiteLLM · ${endpointId}`;
}
