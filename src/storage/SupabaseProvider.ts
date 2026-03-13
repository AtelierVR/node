import { PrismaClient } from "@prisma/client";
import { readFileSync, unlinkSync } from "fs";
import type { IDatabaseProvider } from "./IDatabaseProvider";
import type { IFileProvider, FileWriteOptions } from "./IFileProvider";
import Debug from "../utils/Debug";

/**
 * SupabaseProvider
 *
 * Combined file + database provider that targets a Supabase project:
 *   - **Files**    → Supabase Storage (S3-compatible object storage)
 *   - **Database** → Supabase Postgres accessed via Prisma (same PrismaClient as
 *                    PostgresProvider, just pointed at Supabase's connection string)
 *
 * ─── Setup ────────────────────────────────────────────────────────────────────
 *
 * 1. Install the Supabase JS client:
 *    ```
 *    npm install @supabase/supabase-js
 *    ```
 *
 * 2. Set the following environment variables:
 *    ```
 *    FILE_PROVIDER=supabase
 *    DATABASE_PROVIDER=supabase       # optional — Supabase IS Postgres
 *    SUPABASE_URL=https://<project>.supabase.co
 *    SUPABASE_SERVICE_KEY=<service_role_key>
 *    SUPABASE_BUCKET=assets           # storage bucket (created if absent)
 *    DATABASE_URL=postgresql://postgres.<project>:<password>@<host>:5432/postgres
 *    ```
 *    Use the **Transaction pooler** or **Session pooler** URL from the Supabase
 *    dashboard as `DATABASE_URL` so that Prisma can connect.
 *
 * 3. Remove every `throw new Error(...)` stub below once the client is installed
 *    and replace the TODO blocks with the real Supabase Storage calls.
 *
 * ─── Notes ────────────────────────────────────────────────────────────────────
 * • Migrations should be run via the Supabase CLI (`supabase db push`) rather
 *   than `prisma db push` when using the hosted Supabase service.
 * • The `getLocalPath()` method always returns `null` because files are remote;
 *   callers must use `readFile()` and stream the buffer to the HTTP response.
 */
export class SupabaseProvider implements IFileProvider, IDatabaseProvider {
    private readonly prisma: PrismaClient;

    /** Typed as `any` until @supabase/supabase-js is installed. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private supabase: any;

    private readonly bucket: string;

    constructor() {
        const url = process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_KEY;
        this.bucket = process.env.SUPABASE_BUCKET ?? "assets";

        if (!url || !key) {
            throw new Error(
                "[SupabaseProvider] SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.",
            );
        }

        // TODO: uncomment after running `npm install @supabase/supabase-js`
        // import { createClient } from "@supabase/supabase-js";
        // this.supabase = createClient(url, key);

        // Prisma reads DATABASE_URL from the environment — point it at Supabase's
        // Postgres connection string (Transaction pooler URL recommended).
        this.prisma = new PrismaClient({
            errorFormat: "minimal",
            transactionOptions: {
                maxWait: 5000,
                timeout: 5000,
            },
        });
    }

    // ─── IDatabaseProvider ────────────────────────────────────────────────────

    async connect(): Promise<void> {
        await this.prisma.$connect();
    }

    async disconnect(): Promise<void> {
        await this.prisma.$disconnect();
    }

    async ping(): Promise<boolean> {
        try {
            await this.prisma.$connect();
            await this.prisma.$disconnect();
            return true;
        } catch (e) {
            Debug.error("[SupabaseProvider] ping failed:", e);
            return false;
        }
    }

    /**
     * Supabase migrations are managed externally (Supabase CLI / dashboard).
     * This method is a no-op that always succeeds.
     */
    async runMigrations(): Promise<boolean> {
        Debug.log(
            "[SupabaseProvider] Migrations should be managed via the Supabase CLI " +
            "(`supabase db push`) or the Supabase dashboard — skipping.",
        );
        return true;
    }

    getClient(): PrismaClient {
        return this.prisma;
    }

    // ─── IFileProvider ────────────────────────────────────────────────────────

    async init(): Promise<void> {
        // TODO: create the bucket if it does not already exist
        // const { error } = await this.supabase.storage.createBucket(this.bucket, {
        //     public: false,
        //     allowedMimeTypes: ["application/octet-stream"],
        // });
        // if (error && error.message !== "The resource already exists") throw error;
        Debug.log(
            `[SupabaseProvider] Storage bucket: "${this.bucket}" (init stub — install @supabase/supabase-js)`,
        );
    }

    async readFile(key: string): Promise<Buffer | null> {
        // TODO:
        // const { data, error } = await this.supabase.storage.from(this.bucket).download(key);
        // if (error || !data) return null;
        // return Buffer.from(await data.arrayBuffer());
        throw new Error(
            `[SupabaseProvider] readFile("${key}") not yet implemented — install @supabase/supabase-js`,
        );
    }

    async writeFile(key: string, data: Buffer, options?: FileWriteOptions): Promise<boolean> {
        // TODO:
        // const { error } = await this.supabase.storage.from(this.bucket).upload(key, data, {
        //     contentType: options?.contentType ?? "application/octet-stream",
        //     upsert: true,
        // });
        // return !error;
        throw new Error(
            `[SupabaseProvider] writeFile("${key}") not yet implemented — install @supabase/supabase-js`,
        );
    }

    async storeFromPath(sourcePath: string, key: string, options?: FileWriteOptions): Promise<boolean> {
        // TODO:
        // const data = readFileSync(sourcePath);
        // const ok = await this.writeFile(key, data, options);
        // if (ok) unlinkSync(sourcePath);
        // return ok;
        throw new Error(
            `[SupabaseProvider] storeFromPath("${key}") not yet implemented — install @supabase/supabase-js`,
        );
    }

    async deleteFile(key: string): Promise<boolean> {
        // TODO:
        // const { error } = await this.supabase.storage.from(this.bucket).remove([key]);
        // return !error;
        throw new Error(
            `[SupabaseProvider] deleteFile("${key}") not yet implemented — install @supabase/supabase-js`,
        );
    }

    async existsFile(key: string): Promise<boolean> {
        // TODO:
        // const { data, error } = await this.supabase.storage.from(this.bucket).list("", {
        //     search: key,
        // });
        // return !error && Array.isArray(data) && data.some((f: any) => f.name === key);
        throw new Error(
            `[SupabaseProvider] existsFile("${key}") not yet implemented — install @supabase/supabase-js`,
        );
    }

    async getPublicURL(key: string): Promise<string | null> {
        // TODO:
        // const { data } = this.supabase.storage.from(this.bucket).getPublicUrl(key);
        // return data?.publicUrl ?? null;
        throw new Error(
            `[SupabaseProvider] getPublicURL("${key}") not yet implemented — install @supabase/supabase-js`,
        );
    }

    /**
     * Remote provider — files are not stored on the local filesystem.
     * Always returns `null`.
     */
    getLocalPath(_key: string): string | null {
        return null;
    }

    async listFiles(prefix?: string): Promise<string[]> {
        // TODO:
        // const { data, error } = await this.supabase.storage.from(this.bucket).list(prefix ?? "");
        // if (error || !data) return [];
        // return data.map((f: any) => (prefix ? `${prefix}/${f.name}` : f.name));
        throw new Error(
            `[SupabaseProvider] listFiles("${prefix}") not yet implemented — install @supabase/supabase-js`,
        );
    }

    // ─── URL helpers ──────────────────────────────────────────────────────────

    /**
     * URL scheme used by this provider: `storage://<bucket>/<key>`.
     * Keeps Supabase storage references distinct from local `file://` URLs.
     */
    private get scheme(): string {
        return `storage://${this.bucket}/`;
    }

    /**
     * Returns `true` when the URL starts with `storage://<bucket>/`.
     */
    isLocalFile(url: string): boolean {
        return url.startsWith(this.scheme);
    }

    /**
     * Strips the `storage://<bucket>/` prefix to recover the bare key.
     * `"storage://assets/avatars/42/abc123"` → `"avatars/42/abc123"`
     */
    urlToKey(url: string): string {
        if (!this.isLocalFile(url))
            throw new Error(`[SupabaseProvider] urlToKey: not a storage URL for bucket "${this.bucket}": ${url}`);
        return url.slice(this.scheme.length);
    }

    /**
     * Prepends `storage://<bucket>/` to produce the stored URL.
     * `"avatars/42/abc123"` → `"storage://assets/avatars/42/abc123"`
     */
    keyToUrl(key: string): string {
        return `${this.scheme}${key}`;
    }
}

