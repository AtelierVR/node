import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { NoxIdentifier } from '../common/identifier';
import { WellKnownService } from '../fediverse/well-known.service';
import { ExternalUserDelegate } from 'src/generated/prisma/models';
import { ExternalUser, ExternalUserWithMethods } from './external-user.model';
import { ExternalServerWithMethods } from './external-server.model';
import { ExternalServersService } from './external-servers.service';
import { ApiUser } from '../users/users.types';
import { ApiUserDto } from '../users/dto/user-response.dto';

@Injectable()
export class ExternalUsersService implements OnModuleInit {

    private readonly logger = new Logger(ExternalUsersService.name);

    constructor(
        private readonly prisma: PrismaService,
        public readonly externalServers: ExternalServersService,
        private readonly wellKnown: WellKnownService,
    ) { }

    async onModuleInit(): Promise<void> { }

    // ── Lookup ───────────────────────────────────────────────────────────────────

    async findByIid(id: number, address: string): Promise<ExternalUserWithMethods | null> {
        const model = await this.externalUsers.findFirst({ where: { id, server: { address } } });
        if (!model) return null;
        return ExternalUser.attach(model, this);
    }

    async upsertUser(id: number, server: ExternalServerWithMethods, publicCompact: string): Promise<ExternalUserWithMethods> {
        const serverId = server.id as number;
        const publicBytes = Buffer.from(publicCompact, 'utf8');
        const model = await this.externalUsers.upsert({
            where: { id_serverId: { id, serverId } },
            create: { id, serverId, public: publicBytes, lastSeen: new Date() },
            update: { public: publicBytes, lastSeen: new Date() },
        });
        return ExternalUser.attach(model, this);
    }

    /**
     * Resolves a user from a parsed NoxIdentifier.
     * Returns null for local identifiers.
     */
    async findByIdentifier(identifier: NoxIdentifier): Promise<ExternalUserWithMethods | null> {
        if (identifier.isLocal(await this.wellKnown.address())) return null;
        const numeric = identifier.numericId;
        if (numeric === null) return null;
        return this.findByIid(numeric, identifier.server!);
    }


    async findOrDiscover(identifier: NoxIdentifier): Promise<ExternalUserWithMethods | null> {
        if (identifier.isLocal(await this.wellKnown.address()))
            return null;
        let user = await this.findByIdentifier(identifier);
        if (!user)
            try {
                user = await this.discover(identifier);
            } catch (err: any) {
                this.logger.warn(
                    `Failed to discover external user ${identifier.toString()}: ${err?.message ?? err}`,
                );
                return null;
            }
        return user;
    }

    /**
     * Fetches a remote user from their home server and upserts them locally.
     * Throws if the server cannot be discovered or the user is not found.
     */
    async discover(identifier: NoxIdentifier): Promise<ExternalUserWithMethods> {
        const server = await this.externalServers.findOrDiscover(identifier.server!);
        if (!server)
            throw new Error(`Unable to discover server for "${identifier.server}"`);

        const resp = await server.fetch<ApiUser>(`users/${identifier.id}`, { responseClass: ApiUserDto });
        if (resp.error || !resp.data)
            throw new Error(`Remote server returned an error for user ${identifier.toString()}: ${resp.error?.message ?? 'no data'}`);

        const { public: publicCompact, id } = resp.data;
        if (!publicCompact)
            throw new Error(`Remote user ${identifier.toString()} has no public key`);

        return this.upsertUser(id, server, publicCompact);
    }

    private get externalUsers(): ExternalUserDelegate {
        return this.prisma.externalUsers as ExternalUserDelegate;
    }
}
