import type { IFileProvider } from "./IFileProvider";
import type { IDatabaseProvider } from "./IDatabaseProvider";

/**
 * IStorageProvider
 *
 * Top-level storage abstraction that groups a file provider and a database
 * provider under a single interface.
 *
 * Use `StorageManager` to get a fully configured `IStorageProvider` based on
 * environment variables.
 *
 * Example:
 * ```
 * // Read a world asset from wherever the active file provider stores it
 * const buf = await app.storage.files.readFile("worlds/42/abc123");
 *
 * // Execute a Prisma query through the active database provider
 * const users = await app.storage.database.getClient().user.findMany();
 * ```
 */
export interface IStorageProvider {
    /** File storage backend (local disk, Supabase Storage, …) */
    files: IFileProvider;

    /** Database backend (PostgreSQL via Prisma, Supabase, …) */
    database: IDatabaseProvider;
}
