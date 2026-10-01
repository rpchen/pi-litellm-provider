export declare const LOCK_STALE_MS = 30000;
export interface LockOptions {
    staleMs?: number;
    timeoutMs?: number;
    retryMs?: number;
}
export declare function withFileLock<T>(file: string, fn: () => Promise<T> | T, options?: LockOptions): Promise<T>;
export interface AtomicWriteOptions {
    mode?: number;
    /** Test seam for simulating an interrupted replace. */
    rename?: (from: string, to: string) => void;
}
export interface InPlaceWriteOptions {
    mode?: number;
    /** Test seam: simulates a failing write (e.g. ENOSPC after truncation). */
    writeFile?: (path: string, content: string, options: {
        encoding: BufferEncoding;
        mode?: number;
    }) => void;
}
/**
 * Write a file in place (same inode): Node applies the mode only when creating, so an existing file keeps
 * its mode and ACL exactly like Pi's own FileAuthStorageBackend writes. On failure the previous bytes are
 * restored best-effort so a host-owned file is never left truncated. See design.md D3.
 */
export declare function writeFileInPlace(path: string, content: string, options?: InPlaceWriteOptions): void;
/** Write a sibling temp file then rename over `path`; the temp file never outlives a failure. */
export declare function atomicWriteFile(path: string, content: string, options?: AtomicWriteOptions): void;
