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
/** Write a sibling temp file then rename over `path`; the temp file never outlives a failure. */
export declare function atomicWriteFile(path: string, content: string, options?: AtomicWriteOptions): void;
