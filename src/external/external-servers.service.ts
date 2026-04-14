import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { WellKnownService } from '../fediverse/well-known.service';
import { ExternalServerDelegate } from 'src/generated/prisma/models';
import { ExternalServer, ExternalServerWithMethods } from './external-server.model';
import { discoverWellKnown } from './discover-well-known';

@Injectable()
export class ExternalServersService implements OnModuleInit {


    public readonly logger = new Logger(ExternalServersService.name);

    constructor(
        private readonly prisma: PrismaService,
        public readonly wellKnown: WellKnownService,
    ) { }

    async onModuleInit(): Promise<void> { }

    async checkSelfWellKnown(): Promise<void> {
        const domain = await this.wellKnown.address();
        try {
            const server = await this.discover(domain);
            const wk = await server.wellKnown();
            this.logger.log(`Self well-known OK — ${wk.data.metadata.title} @ ${wk.data.address} (TTL ${Math.round((wk.expiresAt.getTime() - Date.now()) / 1000)}s remaining)`);
        } catch (e) {
            this.logger.error(`Self well-known check failed: ${(e as Error).message}`);
        }
    }

    // ── Lookup ───────────────────────────────────────────────────────────────────

    async findAll(): Promise<ExternalServerWithMethods[]> {
        const models = await this.externalServers.findMany({ orderBy: { rank: 'desc' } });
        return models.map((m) => ExternalServer.attach(m, this));
    }

    async findByAddress(address: string): Promise<ExternalServerWithMethods | null> {
        const model = await this.externalServers.findFirst({ where: { address } });
        if (!model) return null;
        return ExternalServer.attach(model, this);
    }

    async findById(id: number): Promise<ExternalServerWithMethods | null> {
        const model = await this.externalServers.findUnique({ where: { id: id } });
        if (!model) return null;
        return ExternalServer.attach(model, this);
    }

    // ── Discovery ─────────────────────────────────────────────────────────────────

    /**
     * Discovers a remote server by address, upserts it in the database,
     * and returns it as an ExternalServerWithMethods.
     * Throws if discovery fails or the well-known document lacks a publicKey.
     */
    async discover(address: string): Promise<ExternalServerWithMethods> {
        const discovered = await discoverWellKnown(address);
        if (!discovered)
            throw new Error(`Unable to discover /.well-known/nox for "${address}"`);

        const { public: publicKey } = discovered.data;
        if (!publicKey)
            throw new Error(`Well-known document for "${address}" does not expose a publicKey`);

        const publicBytes = Buffer.from(publicKey, 'utf8');

        // Use the canonical address from the well-known document, not the queried address.
        // The queried address may be a gateway-alias domain (e.g. _nox TXT redirect) that
        // resolves to a server whose canonical address differs, causing a unique-key collision
        // on `public` if that server is already registered under its canonical address.
        const canonicalAddress = discovered.data.address;
        if (!canonicalAddress || address !== canonicalAddress) 
            throw new Error(`Well-known document for "${address}" has an invalid canonical address`);
        
        const model = await this.externalServers.upsert({
            where: { address },
            create: {
                address,
                public: publicBytes,
                lastSeen: new Date(),
            },
            update: {
                public: publicBytes,
                lastSeen: new Date(),
            },
        });

        const server = ExternalServer.attach(model, this);
        // Pre-populate the well-known cache with the already-fetched document
        server._wkc = {
            data: discovered.data,
            fetchedAt: new Date(),
            expiresAt: new Date(Date.now() + discovered.ttlMs),
        };
        return server;
    }

    async findOrDiscover(address: string): Promise<ExternalServerWithMethods | null> {
        let server = await this.findByAddress(address);
        if (!server)
            try {
                server = await this.discover(address);
            } catch (e) {
                this.logger.warn(`Discovery failed for "${address}": ${(e as Error).message}`);
                return null;
            }
        return server;
    }

    public get externalServers(): ExternalServerDelegate {
        return this.prisma.externalServers as ExternalServerDelegate;
    }
}
