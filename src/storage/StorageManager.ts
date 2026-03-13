import type { IStorageProvider } from "./IStorageProvider";
import type { IFileProvider } from "./IFileProvider";
import type { IDatabaseProvider } from "./IDatabaseProvider";
import { LocalFileProvider } from "./LocalFileProvider";
import { PostgresProvider } from "./PostgresProvider";
import { SupabaseProvider } from "./SupabaseProvider";
import Debug from "../utils/Debug";

/** Supported file storage backends. */
export type FileProviderType = "local" | "supabase";

/** Supported database backends. */
export type DatabaseProviderType = "postgres" | "supabase";

/**
 * StorageManager
 *
 * Reads environment variables and instantiates the appropriate file and
 * database providers.  Implements `IStorageProvider` so it can be passed
 * wherever that interface is expected.
 *
 * ─── Configuration ────────────────────────────────────────────────────────────
 *
 * | Variable            | Values              | Default    | Description                            |
 * |---------------------|---------------------|------------|----------------------------------------|
 * | `FILE_PROVIDER`     | `local`, `supabase` | `local`    | File storage backend                   |
 * | `DATABASE_PROVIDER` | `postgres`, `supabase` | `postgres` | Database backend                    |
 * | `ASSETS_DIR`        | absolute path       | `<cwd>/assets` | Root dir for local file storage    |
 *
 * Provider-specific variables are documented on the individual provider classes.
 *
 * ─── Usage ────────────────────────────────────────────────────────────────────
 * ```ts
 * // In Main constructor (before Database):
 * this.storage = new StorageManager();
 *
 * // During startup:
 * await this.storage.init();
 *
 * // Reading a file (works regardless of provider):
 * const buf = await this.storage.files.readFile("avatars/42/abc123");
 *
 * // Running a Prisma query (works regardless of provider):
 * const users = await this.storage.database.getClient().user.findMany();
 * ```
 */
export class StorageManager implements IStorageProvider {
    readonly files: IFileProvider;
    readonly database: IDatabaseProvider;

    constructor() {
        const fileType = (process.env.FILE_PROVIDER ?? "local") as FileProviderType;
        const dbType = (process.env.DATABASE_PROVIDER ?? "postgres") as DatabaseProviderType;

        Debug.log(`[StorageManager] File provider:     ${fileType}`);
        Debug.log(`[StorageManager] Database provider: ${dbType}`);

        this.files = StorageManager.buildFileProvider(fileType);
        this.database = StorageManager.buildDatabaseProvider(dbType);
    }

    // ─── Provider factories ───────────────────────────────────────────────────

    private static buildFileProvider(type: FileProviderType): IFileProvider {
        switch (type) {
            case "local":
                return new LocalFileProvider();

            case "supabase":
                return new SupabaseProvider();

            default:
                Debug.error(
                    `[StorageManager] Unknown FILE_PROVIDER "${type}" — falling back to "local".`,
                );
                return new LocalFileProvider();
        }
    }

    private static buildDatabaseProvider(type: DatabaseProviderType): IDatabaseProvider {
        switch (type) {
            case "postgres":
                return new PostgresProvider();

            case "supabase":
                return new SupabaseProvider();

            default:
                Debug.error(
                    `[StorageManager] Unknown DATABASE_PROVIDER "${type}" — falling back to "postgres".`,
                );
                return new PostgresProvider();
        }
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    /**
     * Initialise the file provider (create directories / buckets as needed).
     * Must be called once during application startup, before serving requests.
     */
    async init(): Promise<void> {
        await this.files.init();
    }
}
