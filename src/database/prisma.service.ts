import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { spawn } from 'node:child_process';
import { PrismaClient } from '../generated/prisma/client';

/**
 * Wraps the Prisma v7 dynamically generated PrismaClient.
 * Uses composition with explicit typed model delegates to work around TypeScript's
 * inability to resolve members of a class built at runtime via `getPrismaClientClass()`.
 *
 * Add a getter per model when expanding the schema.
 */
@Injectable()
export class PrismaService implements OnModuleInit {

    private readonly logger = new Logger(PrismaService.name);
    private readonly _client: PrismaClient;

    private _readyResolve!: () => void;
    private _readyReject!: (err: unknown) => void;

    /** Resolves once the database is reachable; rejects if the probe fails. */
    readonly ready: Promise<void> = new Promise<void>(
        (resolve, reject) => {
            this._readyResolve = resolve;
            this._readyReject = reject;
        },
    );

    constructor() {
        const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
        this._client = new PrismaClient({ adapter });
    }

    async onModuleInit(): Promise<void> {
        try {
            this.logger.log("Connecting to database...");
            await this._client.$connect();
            this.logger.log("Connected to database, applying migrations if needed...");
            await this.deploy();
            this.logger.log("Database is ready");
            this._readyResolve();
        } catch (err) {
            this.logger.error("Database connection failed:", err);
            this._readyReject(err);
        }
    }

    /**
     * Apply all pending Prisma migrations by running `prisma migrate deploy`.
     */
    private async deploy(): Promise<boolean> {
        return new Promise((resolve) => {
            const proc = spawn(
                "npm", ["run", "prisma:deploy"],
                { env: process.env, cwd: '/app' },
            );

            const onLine = (line: string, isErr: boolean) => {
                if (!line.trim()) return;
                if (isErr) this.logger.warn(`[Migrate] ${line}`);
                else this.logger.log(`[Migrate] ${line}`);
            };

            proc.stdout.on("data", (data: Buffer) =>
                data.toString().split(/\r?\n/).forEach(l => onLine(l, false)));
            proc.stderr.on("data", (data: Buffer) =>
                data.toString().split(/\r?\n/).forEach(l => onLine(l, true)));

            proc.on("close", (code) => {
                if (code !== 0)
                    this.logger.error(`[Migrate] prisma migrate deploy exited with code ${code}`);
                resolve(code === 0);
            });

            proc.on("error", (err) => {
                this.logger.error("[Migrate] Failed to spawn migrate process:", err);
                resolve(false);
            });
        });
    }

    // ── Model delegates ───────────────────────────────────────────────────────────

    get configs() {
        return this._client.config;
    }

    get users() {
        return this._client.user;
    }

    get sessions() {
        return this._client.session;
    }

    get devices() {
        return this._client.device;
    }

    get verificationFactors() {
        return this._client.verificationFactor;
    }

    get externalUsers() {
        return this._client.externalUser;
    }

    get externalServers() {
        return this._client.externalServer;
    }

    get userRelations() {
        return this._client.userRelation;
    }

    get worlds() {
        return this._client.world;
    }

    get worldAssets() {
        return this._client.worldAsset;
    }

    get userTables() {
        return this._client.userTable;
    }

    get avatars() {
        return this._client.avatar;
    }

    get avatarAssets() {
        return this._client.avatarAsset;
    }

    get activityEvents() {
        return this._client.activityEvent;
    }

    get instances() {
        return this._client.instance;
    }

     get relays() {
        return this._client.relay;
    }

    get relayTokens() {
        return this._client.relayToken;
    }
}
