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
     * Apply all pending Prisma migrations by running `prisma migrate deploy`.
     */
    async runMigrations(): Promise<boolean> {
        return new Promise((resolve) => {
            const proc = child_process.spawn(
                "npx", ["prisma", "migrate", "deploy"],
                { env: process.env },
            );

            const onLine = (line: string, isErr: boolean) => {
                if (!line.trim()) return;
                if (isErr) Debug.error(`[Migrate] ${line}`);
                else Debug.log(`[Migrate] ${line}`);
            };

            proc.stdout.on("data", (data: Buffer) =>
                data.toString().split(/\r?\n/).forEach(l => onLine(l, false)));
            proc.stderr.on("data", (data: Buffer) =>
                data.toString().split(/\r?\n/).forEach(l => onLine(l, true)));

            proc.on("close", (code) => {
                if (code !== 0)
                    Debug.error(`[Migrate] prisma migrate deploy exited with code ${code}`);
                resolve(code === 0);
            });

            proc.on("error", (err) => {
                Debug.error("[Migrate] Failed to spawn migrate process:", err);
                resolve(false);
            });
        });
    }

    getClient(): PrismaClient {
        return this.client;
    }
}
