import {
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
    unlinkSync,
    readdirSync,
    copyFileSync,
} from "fs";
import { join, dirname } from "path";
import { cwd } from "process";
import type { IFileProvider, FileWriteOptions } from "./IFileProvider";
import Debug from "../utils/Debug";

/**
 * LocalFileProvider
 *
 * Stores files on the local filesystem under a configurable base directory
 * (default: `<cwd>/assets`).
 *
 * This is the default file provider and mirrors the current behaviour that was
 * previously spread across `WorldAsset`, `AvatarAsset`, `User`, `Avatar`, etc.
 *
 * File keys are relative paths within the base directory, e.g.:
 *   - `"avatars/42/abc123"`           — avatar asset
 *   - `"worlds/7/abc123.gz"`          — world asset (gzip-compressed)
 *   - `"abc123-png.png"`              — user/avatar thumbnail
 */
export class LocalFileProvider implements IFileProvider {
    private readonly baseDir: string;

    /**
     * @param baseDir Absolute path to the root asset directory.
     *                Falls back to `ASSETS_DIR` env var, then `<cwd>/assets`.
     */
    constructor(baseDir?: string) {
        this.baseDir = baseDir ?? process.env.ASSETS_DIR ?? join(cwd(), "assets");
    }

    // ─── IFileProvider ────────────────────────────────────────────────────────

    async init(): Promise<void> {
        if (!existsSync(this.baseDir)) {
            mkdirSync(this.baseDir, { recursive: true });
        }
        Debug.log(`[LocalFileProvider] Base directory: ${this.baseDir}`);
    }

    async readFile(key: string): Promise<Buffer | null> {
        const fullPath = join(this.baseDir, key);
        if (!existsSync(fullPath)) return null;
        try {
            return readFileSync(fullPath);
        } catch (e) {
            Debug.error("[LocalFileProvider] readFile error:", e);
            return null;
        }
    }

    async writeFile(key: string, data: Buffer, _options?: FileWriteOptions): Promise<boolean> {
        try {
            const fullPath = join(this.baseDir, key);
            const dir = dirname(fullPath);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            writeFileSync(fullPath, data);
            return true;
        } catch (e) {
            Debug.error("[LocalFileProvider] writeFile error:", e);
            return false;
        }
    }

    async storeFromPath(sourcePath: string, key: string, _options?: FileWriteOptions): Promise<boolean> {
        try {
            const fullPath = join(this.baseDir, key);
            const dir = dirname(fullPath);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            copyFileSync(sourcePath, fullPath);
            unlinkSync(sourcePath);
            return true;
        } catch (e) {
            Debug.error("[LocalFileProvider] storeFromPath error:", e);
            return false;
        }
    }

    async deleteFile(key: string): Promise<boolean> {
        try {
            const fullPath = join(this.baseDir, key);
            if (!existsSync(fullPath)) return false;
            unlinkSync(fullPath);
            return true;
        } catch (e) {
            Debug.error("[LocalFileProvider] deleteFile error:", e);
            return false;
        }
    }

    async existsFile(key: string): Promise<boolean> {
        return existsSync(join(this.baseDir, key));
    }

    /**
     * Local files are exposed through the API endpoints (`/api/worlds/:id/assets/:id/file`,
     * etc.) and do **not** have a standalone public URL.
     */
    async getPublicURL(_key: string): Promise<string | null> {
        return null;
    }

    getLocalPath(key: string): string | null {
        const fullPath = join(this.baseDir, key);
        return existsSync(fullPath) ? fullPath : null;
    }

    async listFiles(prefix?: string): Promise<string[]> {
        try {
            const dir = prefix ? join(this.baseDir, prefix) : this.baseDir;
            if (!existsSync(dir)) return [];
            return readdirSync(dir).map((f) => (prefix ? `${prefix}/${f}` : f));
        } catch {
            return [];
        }
    }

    // ─── Helpers used by legacy code ─────────────────────────────────────────

    /** The absolute path to the base assets directory. */
    get basePath(): string {
        return this.baseDir;
    }

    // ─── URL helpers ──────────────────────────────────────────────────────────

    private static readonly SCHEME = "file://";

    /**
     * Returns `true` for any URL that starts with `file://`.
     * Used instead of hard-coding `url.startsWith('file://')` in model classes.
     */
    isLocalFile(url: string): boolean {
        return url.startsWith(LocalFileProvider.SCHEME);
    }

    /**
     * Strips the `file://` prefix and returns the bare storage key.
     * `"file://avatars/42/abc123"` → `"avatars/42/abc123"`
     */
    urlToKey(url: string): string {
        if (!this.isLocalFile(url))
            throw new Error(`[LocalFileProvider] urlToKey: not a file:// URL: ${url}`);
        return url.slice(LocalFileProvider.SCHEME.length);
    }

    /**
     * Prepends `file://` to produce the stored URL.
     * `"avatars/42/abc123"` → `"file://avatars/42/abc123"`
     */
    keyToUrl(key: string): string {
        return `${LocalFileProvider.SCHEME}${key}`;
    }
}
