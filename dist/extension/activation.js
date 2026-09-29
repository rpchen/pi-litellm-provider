import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
export function activationPath(agentDir = getAgentDir()) {
    return join(agentDir, "litellm.activation.json");
}
export function loadActivation(path = activationPath(), logger = console) {
    if (!existsSync(path))
        return { mode: "all" };
    try {
        const value = JSON.parse(readFileSync(path, "utf8"));
        if (typeof value !== "object" || value === null || Array.isArray(value))
            throw new Error("需要对象");
        const input = value;
        if (input.mode === "all")
            return { mode: "all" };
        if (input.mode === "selected" && Array.isArray(input.endpointIds) && input.endpointIds.every((id) => typeof id === "string")) {
            return { mode: "selected", endpointIds: [...new Set(input.endpointIds)] };
        }
        throw new Error("需要 mode=all 或 mode=selected + endpointIds");
    }
    catch (error) {
        logger.warn(`LiteLLM activation 配置 ${path} 非法，已回退为全部启用：${error instanceof Error ? error.message : String(error)}`);
        return { mode: "all" };
    }
}
export function saveActivation(value, path = activationPath()) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}
export function activeEndpointIds(endpointIds, activation) {
    if (activation.mode === "all")
        return [...endpointIds];
    const selected = new Set(activation.endpointIds);
    return endpointIds.filter((id) => selected.has(id));
}
export function toggleEndpoint(endpointIds, activation, endpointId) {
    const selected = new Set(activation.mode === "all"
        ? endpointIds
        : activation.endpointIds);
    if (selected.has(endpointId))
        selected.delete(endpointId);
    else
        selected.add(endpointId);
    return { mode: "selected", endpointIds: [...selected] };
}
