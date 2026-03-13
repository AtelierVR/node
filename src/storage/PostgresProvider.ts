import { PrismaClient } from "@prisma/client";
import child_process from "child_process";
import type { IDatabaseProvider } from "./IDatabaseProvider";
import Debug from "../utils/Debug";

/**
 * PostgresProvider
 *
 * Default database provider. Wraps a `PrismaClient` connected to a PostgreSQL
 * database whose URL is read from the `DATABASE_URL` environment variable —
 * exactly the same setup that was previously contained in `Database.ts`.
 *
 * Required environment variable:
 *   DATABASE_URL  — PostgreSQL connection string used by Prisma
 *                   (e.g. `postgresql://user:pass@host:5432/db`)
 */
export class PostgresProvider implements IDatabaseProvider {
    private readonly client: PrismaClient;

    constructor() {
        this.client = new PrismaClient({
            errorFormat: "minimal",
            transactionOptions: {
                maxWait: 1000,
                timeout: 1000,
            },
        });
    }

    // ─── IDatabaseProvider ────────────────────────────────────────────────────

    async connect(): Promise<void> {
        await this.client.$connect();
    }

    async disconnect(): Promise<void> {
        await this.client.$disconnect();
    }

    async ping(): Promise<boolean> {
        try {
            await this.client.$connect();
            await this.client.$disconnect();
            return true;
        } catch (e) {
            Debug.error("[PostgresProvider] ping failed:", e);
            return false;
        }
    }

    /**
     * Push the current Prisma schema to the database by running `npm run deploy`
     * (which executes `prisma db push`).
     */
    async runMigrations(): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            const proc = child_process.spawn("npm", ["run", "deploy"]);

            proc.stdout.on("data", (data) => Debug.debug(`[Migrate] ${data}`));
            proc.stderr.on("data", (data) => Debug.error(`[Migrate] ${data}`));
            proc.on("close", (code) => resolve(code === 0));
        });
    }

    getClient(): PrismaClient {
        return this.client;
    }
}
