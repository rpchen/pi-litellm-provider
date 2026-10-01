/**
 * Host-owned persisted state for an endpoint: credential (auth.json) and discovery catalog
 * (models-store.json). Both are keyed by provider id. See design.md D3/D4.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { withFileLock, writeFileInPlace } from "./fs-lock.js";
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
// Host-owned files (auth.json / models-store.json) are written in place so an existing mode/ACL survives:
// Pi itself only applies 0600 on creation and keeps administrator-managed permissions afterwards.
function writeJson(path, data, write) {
    writeFileInPlace(path, JSON.stringify(data, null, 2), { mode: 0o600, ...(write ? { writeFile: write } : {}) });
}
/** Connect or replace: same `{type:"api_key",key}` shape Pi's `/login` stores. */
export async function saveStoredCredential(agentDir, providerId, key, write) {
    const path = authPath(agentDir);
    await withFileLock(path, () => {
        const { data } = readJsonObject(path);
        writeJson(path, { ...data, [providerId]: { type: "api_key", key } }, write);
    });
}
/** Removes only `providerId`; returns whether an entry existed. Missing file is not created. */
export async function removeStoredCredential(agentDir, providerId, write) {
    return removeKey(authPath(agentDir), providerId, write);
}
/** Removes the persisted discovery catalog/snapshot for `providerId`. */
export async function removeModelsStoreEntry(agentDir, providerId, write) {
    return removeKey(modelsStorePath(agentDir), providerId, write);
}
async function removeKey(path, key, write) {
    if (!existsSync(path))
        return false;
    return withFileLock(path, () => {
        const { exists, data } = readJsonObject(path);
        if (!exists || !Object.prototype.hasOwnProperty.call(data, key))
            return false;
        const { [key]: _removed, ...rest } = data;
        writeJson(path, rest, write);
        return true;
    });
}
