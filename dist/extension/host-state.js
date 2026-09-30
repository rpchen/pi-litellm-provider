/**
 * Host-owned persisted state for an endpoint: credential (auth.json) and discovery catalog
 * (models-store.json). Both are keyed by provider id. See design.md D3/D4.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { atomicWriteFile, withFileLock } from "./fs-lock.js";
export class HostStateError extends Error {
    constructor(message) {
        super(message);
        this.name = "HostStateError";
    }
}
export const authPath = (agentDir) => join(agentDir, "auth.json");
export const modelsStorePath = (agentDir) => join(agentDir, "models-store.json");
function readJsonObject(path) {
    if (!existsSync(path))
        return { exists: false, data: {} };
    const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
    if (text.trim().length === 0)
        return { exists: true, data: {} };
    let value;
    try {
        value = JSON.parse(text);
    }
    catch {
        throw new HostStateError(`${basename(path)} 无法解析，已拒绝修改以免覆盖其中的内容`);
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new HostStateError(`${basename(path)} 不是 JSON 对象，已拒绝修改`);
    }
    return { exists: true, data: value };
}
export function credentialState(agentDir, providerId) {
    try {
        return Object.prototype.hasOwnProperty.call(readJsonObject(authPath(agentDir)).data, providerId) ? "stored" : "none";
    }
    catch {
        return "unknown";
    }
}
export function validateApiKey(raw) {
    const key = raw.trim();
    if (key.length === 0)
        return { ok: false, message: "API Key 不能为空" };
    if (/[\s\u0000-\u001f\u007f]/u.test(key))
        return { ok: false, message: "API Key 不能包含空白或控制字符" };
    return { ok: true, key };
}
function writeJson(path, data) {
    atomicWriteFile(path, JSON.stringify(data, null, 2), { mode: 0o600 });
}
/** Connect or replace: same `{type:"api_key",key}` shape Pi's `/login` stores. */
export async function saveStoredCredential(agentDir, providerId, key) {
    const path = authPath(agentDir);
    await withFileLock(path, () => {
        const { data } = readJsonObject(path);
        writeJson(path, { ...data, [providerId]: { type: "api_key", key } });
    });
}
/** Removes only `providerId`; returns whether an entry existed. Missing file is not created. */
export async function removeStoredCredential(agentDir, providerId) {
    return removeKey(authPath(agentDir), providerId);
}
/** Removes the persisted discovery catalog/snapshot for `providerId`. */
export async function removeModelsStoreEntry(agentDir, providerId) {
    return removeKey(modelsStorePath(agentDir), providerId);
}
async function removeKey(path, key) {
    if (!existsSync(path))
        return false;
    return withFileLock(path, () => {
        const { exists, data } = readJsonObject(path);
        if (!exists || !Object.prototype.hasOwnProperty.call(data, key))
            return false;
        const { [key]: _removed, ...rest } = data;
        writeJson(path, rest);
        return true;
    });
}
