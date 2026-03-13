import { PrismaClient } from "@prisma/client";
import Env from "./utils/Environment";
import UserManager from "./users/UserManager";
import Main from "./Main";
import Debug from "./utils/Debug";
import { Security } from "./utils/Security";

/**
 * Database
 *
 * Thin proxy over the active `IDatabaseProvider`'s `PrismaClient`.
 * All Prisma model accessors (e.g. `this.app.database.user.findMany(...)`) and
 * client methods (e.g. `this.app.database.$transaction(...)`) are forwarded
 * transparently to the underlying client via a JavaScript `Proxy`.
 *
 * The concrete provider (PostgreSQL, Supabase, …) is selected by `StorageManager`
 * based on the `DATABASE_PROVIDER` environment variable.
 *
 * The `whenReady()` method retains the startup + admin-seed logic that was
 * previously part of the old `Database extends PrismaClient` class.
 */

// Declaration merging — must use named exports (not `export default`) for
// interface + class merging to work in TypeScript.
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface Database extends PrismaClient {}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class Database {
    constructor(private readonly app: Main) {
        const client = app.storage.database.getClient();

        // Return a Proxy so every PrismaClient property / method access on
        // `this.app.database` is forwarded to the actual PrismaClient while
        // Database-specific methods (whenReady, etc.) remain on this class.
        return new Proxy(this, {
            get(target: any, prop: string | symbol, receiver: any) {
                if (prop in target) return Reflect.get(target, prop, receiver);
                const value = (client as any)[prop];
                if (typeof value === "function") return value.bind(client);
                return value;
            },
        }) as Database;
    }

    // ─── Startup / seeding ────────────────────────────────────────────────────

    /**
     * Verify the database is reachable and the admin user exists.
     * If the schema is missing it is pushed via the active database provider.
     * Returns `true` on success or an `Error` on permanent failure.
     */
    async whenReady(): Promise<Error | true> {
        const provider = this.app.storage.database;

        const reachable = await provider.ping();
        if (!reachable) {
            const msg = "Database connection failed.";
            Debug.error(msg);
            return new Error(msg);
        }

        // Inject client into Env so DB-override config resolution works.
        Env.setDatabase(provider.getClient());

        let updated = false;
        while (!updated) {
            try {
                if (!await provider.runMigrations()) 
                    throw new Error("Migrations failed");

                let admin_id = Env.sync('ADMIN_ID');
                if (!admin_id || !UserManager.isValidId(admin_id))
                    admin_id = 1;

                const cert = Security.generateSubCertificate(
                    Env.sync('ADMIN_USERNAME'),
                    `${admin_id}@${this.app.server.getInfos().address}`,
                    1,
                );

                // Read existing tags so we can add sys:admin without wiping others
                const existing = await (this as any).user.findUnique({
                    where: { id: admin_id },
                    select: { tags: true },
                });
                const existingTags: string[] = existing?.tags ?? [];
                const mergedTags = existingTags.includes("sys:admin")
                    ? existingTags
                    : [...existingTags, "sys:admin"];

                // `this` is the Proxy — model accessors are forwarded to PrismaClient
                await (this as any).$transaction([
                    (this as any).user.upsert({
                        where: { id: admin_id },
                        create: {
                            id: admin_id,
                            username: Env.sync('ADMIN_USERNAME'),
                            display: Env.sync('ADMIN_DISPLAY'),
                            password: Env.sync('ADMIN_PASSWORD'),
                            links: [this.app.server.getInfos().gateways.http.toString()],
                            cert_blob: Security.certificateToDer(cert),
                            cert_expires: cert.validity.notAfter,
                            key_blob: Security.privateKeyToDer(Security.privateKey),
                            tags: ["sys:admin"],
                        },
                        update: {
                            username: Env.sync('ADMIN_USERNAME'),
                            display: Env.sync('ADMIN_DISPLAY'),
                            password: Env.sync('ADMIN_PASSWORD'),
                            links: [this.app.server.getInfos().gateways.http.toString()],
                            tags: mergedTags,
                        },
                    }),
                ]);

                updated = true;
            } catch (_e) {
            }
        }

        return true;
    }
}

export default Database;
