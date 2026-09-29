export type EndpointActivation = {
    readonly mode: "all";
} | {
    readonly mode: "selected";
    readonly endpointIds: readonly string[];
};
export interface ActivationLogger {
    warn(message: string): void;
}
export declare function activationPath(agentDir?: string): string;
export declare function loadActivation(path?: string, logger?: ActivationLogger): EndpointActivation;
export declare function saveActivation(value: EndpointActivation, path?: string): void;
export declare function activeEndpointIds(endpointIds: readonly string[], activation: EndpointActivation): string[];
export declare function toggleEndpoint(endpointIds: readonly string[], activation: EndpointActivation, endpointId: string): EndpointActivation;
