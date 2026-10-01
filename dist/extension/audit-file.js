/**
 * Audit file sink for Pi: `<agentDir>/litellm-audit/litellm-audit-<ISO>-<16hex>.json`.
 *
 * Directory 0700, files 0600, atomic sibling-rename so a failed export never
 * leaves a truncated report. Paths are always absolute.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, rmSync, renameSync, chmodSync, existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
export function auditDirectory(agentDir) {
    return resolve(agentDir, "litellm-audit");
}
function failureMessage(error) {
    const code = typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : undefined;
    if (code === "EACCES" || code === "EPERM")
        return "审查报告目录不可写";
    if (code === "ENOSPC")
        return "磁盘空间不足";
    if (code === "EEXIST")
        return "报告文件已存在，请重试";
    return "审查报告写入失败";
}
export function auditFailureMessage(error) {
    return failureMessage(error);
}
export function writeAuditFile(report, directory) {
    const destination = resolve(directory);
    mkdirSync(destination, { recursive: true, mode: 0o700 });
    try {
        if (process.platform !== "win32")
            chmodSync(destination, 0o700);
    }
    catch { /* best effort */ }
    const id = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomBytes(16).toString("hex")}`;
    const target = join(destination, `litellm-audit-${id}.json`);
    const temporary = join(destination, `.litellm-audit-${id}.tmp`);
    try {
        writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
        renameSync(temporary, target);
        if (!isAbsolute(target))
            throw new Error("导出路径不是绝对路径");
        return target;
    }
    catch (error) {
        rmSync(temporary, { force: true });
        throw new Error(failureMessage(error));
    }
}
export function isAuditFilePath(value) {
    return existsSync(value) && value.includes("litellm-audit-");
}
