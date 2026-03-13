/**
 * Options for writing a file.
 */
export interface FileWriteOptions {
    /** MIME content type of the file (e.g. "application/octet-stream") */
    contentType?: string;
    /** Arbitrary key-value metadata to attach to the file */
    metadata?: Record<string, string>;
}

/**
 * IFileProvider
 *
 * Abstraction over any file storage backend (local disk, Supabase Storage, S3 …).
 * Every method is async so that remote providers can be used without special-casing
 * in the calling code.
 */
export interface IFileProvider {
    /**
     * Initialise the provider.
     * For local providers this creates the base directory; for remote providers
     * this may create a storage bucket if it does not already exist.
     * Must be called once before any other method.
     */
    init(): Promise<void>;

    /**
     * Read a file by its key. Returns `null` if the file does not exist.
     */
    readFile(key: string): Promise<Buffer | null>;

    /**
     * Write raw bytes to `key`. Returns `true` on success.
     */
    writeFile(key: string, data: Buffer, options?: FileWriteOptions): Promise<boolean>;

    /**
     * Move a file from `sourcePath` (e.g. a multer temp path) into storage under
     * `key`.  The source file is removed after a successful write.
     * Returns `true` on success.
     */
    storeFromPath(sourcePath: string, key: string, options?: FileWriteOptions): Promise<boolean>;

    /**
     * Delete a file by key. Returns `true` if the file existed and was deleted.
     */
    deleteFile(key: string): Promise<boolean>;

    /**
     * Check whether a file exists.
     */
    existsFile(key: string): Promise<boolean>;

    /**
     * Return a publicly accessible URL for the file, or `null` if the provider
     * does not expose public URLs (local providers fall into this category — files
     * are served through the API instead).
     */
    getPublicURL(key: string): Promise<string | null>;

    /**
     * Return the absolute path on the local filesystem for `key`, or `null` if this
     * provider does not store files locally (remote providers return `null`).
     * Used by code that needs to stream files directly (e.g. `res.sendFile(...)`).
     */
    getLocalPath(key: string): string | null;

    /**
     * List all file keys under the given `prefix` (optional). Returns an empty
     * array if the prefix does not exist or the provider has no files.
     */
    listFiles(prefix?: string): Promise<string[]>;

    // ─── URL helpers ──────────────────────────────────────────────────────────

    /**
     * Return `true` when the given URL string refers to a file managed by this
     * provider (e.g. starts with `"file://"` for `LocalFileProvider`, or with
     * the Supabase bucket prefix for `SupabaseProvider`).
     *
     * Use this instead of hard-coding `url.startsWith('file://')` in model classes
     * so the check stays correct regardless of which provider is active.
     */
    isLocalFile(url: string): boolean;

    /**
     * Extract the storage **key** from a provider URL.
     *
     * Example (LocalFileProvider):  `"file://avatars/42/abc123"` → `"avatars/42/abc123"`
     * Example (SupabaseProvider):   `"storage://assets/avatars/42/abc123"` → `"avatars/42/abc123"`
     *
     * Throws if the URL does not belong to this provider (call `isLocalFile` first).
     */
    urlToKey(url: string): string;

    /**
     * Build the provider URL for a given storage **key**.
     *
     * Example (LocalFileProvider):  `"avatars/42/abc123"` → `"file://avatars/42/abc123"`
     * Example (SupabaseProvider):   `"avatars/42/abc123"` → `"storage://assets/avatars/42/abc123"`
     */
    keyToUrl(key: string): string;
}
