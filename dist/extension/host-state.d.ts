export declare class HostStateError extends Error {
    constructor(message: string);
}
export type CredentialState = "stored" | "none" | "unknown";
export declare const authPath: (agentDir: string) => string;
export declare const modelsStorePath: (agentDir: string) => string;
export declare function credentialState(agentDir: string, providerId: string): CredentialState;
export type ApiKeyCheck = {
    ok: true;
    key: string;
} | {
    ok: false;
    message: string;
};
export declare function validateApiKey(raw: string): ApiKeyCheck;
/** Connect or replace: same `{type:"api_key",key}` shape Pi's `/login` stores. */
export declare function saveStoredCredential(agentDir: string, providerId: string, key: string): Promise<void>;
/** Removes only `providerId`; returns whether an entry existed. Missing file is not created. */
export declare function removeStoredCredential(agentDir: string, providerId: string): Promise<boolean>;
/** Removes the persisted discovery catalog/snapshot for `providerId`. */
export declare function removeModelsStoreEntry(agentDir: string, providerId: string): Promise<boolean>;
