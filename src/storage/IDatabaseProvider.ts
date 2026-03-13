import type { PrismaClient } from "@prisma/client";

/**
 * IDatabaseProvider
 *
 * Abstraction over a relational database backend.
 *
 * All implementations expose a PrismaClient so that existing model queries
 * (e.g. `app.database.user.findMany(...)`) continue to work regardless of
 * which concrete provider is selected.
 *
 * For providers that use Supabase or another hosted Postgres service, the
 * PrismaClient is simply pointed at the provider's Postgres connection string
 * via the `DATABASE_URL` environment variable.
 */
export interface IDatabaseProvider {
    /**
     * Open the database connection.
     * Called once during startup before any queries are issued.
     */
    connect(): Promise<void>;

    /**
     * Close the database connection gracefully.
     */
    disconnect(): Promise<void>;

    /**
     * Return `true` if the database is reachable, `false` otherwise.
     * Used for health-checks and startup retry loops.
     */
    ping(): Promise<boolean>;

    /**
     * Apply pending schema migrations / push the current Prisma schema to the
     * database.  Returns `true` on success.
     *
     * For providers that manage migrations externally (e.g. Supabase CLI),
     * implementations may log a warning and return `true` immediately.
     */
    runMigrations(): Promise<boolean>;

    /**
     * Return the underlying PrismaClient instance.
     * The rest of the application accesses models through this client.
     */
    getClient(): PrismaClient;
}
