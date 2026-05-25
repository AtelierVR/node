import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { WellKnownService } from '../fediverse/well-known.service';
import { StorageService } from '../storage/storage.service';
import { NoxIdentifier } from '../common/identifier';
import { ApiException } from '../api/api-exception';
import { ApiErrorCode } from '../api/api-error.factory';
import type { UserWithMethods } from '../users/user.model';
import { Instance } from 'src/generated/prisma/client';
import type { WsGateway } from '../ws/ws.gateway';

export interface CreateInstanceDto {
    name?: string;
    title?: string | null;
    description?: string | null;
    capacity: number;
    worldRef: string;
    ownerRef: string;
    tags?: string[];
    thumbnail?: string | null;
    useWhitelist?: boolean;
    whitelistRefs?: string[];
    usePassword?: boolean;
    password?: string | null;
}

export interface UpdateInstanceDto {
    title?: string | null;
    description?: string | null;
    capacity?: number;
    tags?: string[];
    thumbnail?: string | null;
    useWhitelist?: boolean;
    whitelistRefs?: string[];
    usePassword?: boolean;
    password?: string | null;
}

export interface InstanceSearchParams {
    query?: string;
    world?: string;
    owner?: string;
}

/** Callbacks fired when an instance is created (receives the new instance id). */
const instanceCreatedHooks: ((id: number) => void)[] = [];

@Injectable()
export class InstancesService {

    private readonly logger = new Logger(InstancesService.name);

    constructor(
        private readonly prisma: PrismaService,
        public readonly wellKnown: WellKnownService,
        public readonly storage: StorageService,
        @Inject(forwardRef(() => require('../ws/ws.gateway').WsGateway))
        private readonly wsGateway: WsGateway,
    ) { }

    /** Register a callback invoked when any instance is created. */
    onInstanceCreated(hook: (id: number) => void) { instanceCreatedHooks.push(hook); }

    async domain(): Promise<string> {
        return this.wellKnown.address();
    }

    // ── Validators ───────────────────────────────────────────────────────────────

    private static readonly NAME_REGEX = /^[a-z0-9_-]{3,32}$/;

    isValidName(name: string): boolean {
        return InstancesService.NAME_REGEX.test(name);
    }

    isValidCapacity(n: number): boolean {
        return Number.isInteger(n) && n >= 0 && n <= 65535;
    }

    generateName(): string {
        return randomBytes(4).toString('hex');
    }

    // ── Permissions ──────────────────────────────────────────────────────────────

    canCreate(user: UserWithMethods): boolean {
        return user.isAdmin() || user.tags.includes('sys:can_instance_create');
    }

    canUploadFile(user: UserWithMethods): boolean {
        return user.isAdmin() || user.tags.includes('sys:can_file_upload');
    }

    canManage(user: UserWithMethods, instance: Instance): boolean {
        if (user.isAdmin()) return true;
        const domain = NoxIdentifier.LOCALSERVER;
        const ownerRef = NoxIdentifier.parse(instance.ownerRef);
        if (ownerRef.isLocal(domain)) {
            const ownerId = ownerRef.numericId;
            if (ownerId !== null && ownerId === user.id) return true;
        }
        return false;
    }

    // ── CRUD ──────────────────────────────────────────────────────────────────────

    async findById(id: number): Promise<Instance | null> {
        return this.prisma.instances.findUnique({ where: { id } });
    }

    async findByName(name: string): Promise<Instance | null> {
        return this.prisma.instances.findUnique({ where: { name } });
    }

    async search(params: InstanceSearchParams, limit = 10, offset = 0): Promise<{ items: Instance[]; total: number }> {
        const conditions: any[] = [];

        if (params.query) {
            conditions.push({
                OR: [
                    { name: { contains: params.query, mode: 'insensitive' } },
                    { title: { contains: params.query, mode: 'insensitive' } },
                    { description: { contains: params.query, mode: 'insensitive' } },
                ],
            });
        }

        if (params.world) conditions.push({ worldRef: params.world });
        if (params.owner) conditions.push({ ownerRef: params.owner });

        const where = conditions.length > 0 ? { AND: conditions } : {};

        const [items, total] = await Promise.all([
            this.prisma.instances.findMany({ where, skip: offset, take: limit, orderBy: { createdAt: 'desc' } }),
            this.prisma.instances.count({ where }),
        ]);

        return { items, total };
    }

    async create(dto: CreateInstanceDto): Promise<Instance> {
        const name = dto.name && this.isValidName(dto.name) ? dto.name : this.generateName();

        // Ensure uniqueness
        let finalName = name;
        let attempts = 0;
        while (await this.prisma.instances.findUnique({ where: { name: finalName } })) {
            finalName = this.generateName();
            if (++attempts > 10) throw new ApiException(ApiErrorCode.INTERNAL_SERVER_ERROR, null, 'Could not generate unique instance name');
        }

        return this.prisma.instances.create({
            data: {
                name: finalName,
                title: dto.title ?? null,
                description: dto.description ?? null,
                capacity: dto.capacity,
                worldRef: dto.worldRef,
                ownerRef: dto.ownerRef,
                tags: dto.tags ?? [],
                thumbnail: dto.thumbnail ?? null,
                useWhitelist: dto.useWhitelist ?? false,
                whitelistRefs: dto.whitelistRefs ?? [],
                usePassword: dto.usePassword ?? false,
                password: dto.password ?? null,
            },
        }).then(inst => {
            for (const hook of instanceCreatedHooks) hook(inst.id);
            return inst;
        });
    }

    async update(id: number, dto: UpdateInstanceDto): Promise<Instance> {
        return this.prisma.instances.update({
            where: { id },
            data: {
                ...(dto.title !== undefined && { title: dto.title }),
                ...(dto.description !== undefined && { description: dto.description }),
                ...(dto.capacity !== undefined && { capacity: dto.capacity }),
                ...(dto.tags !== undefined && { tags: dto.tags }),
                ...(dto.thumbnail !== undefined && { thumbnail: dto.thumbnail }),
                ...(dto.useWhitelist !== undefined && { useWhitelist: dto.useWhitelist }),
                ...(dto.whitelistRefs !== undefined && { whitelistRefs: dto.whitelistRefs }),
                ...(dto.usePassword !== undefined && { usePassword: dto.usePassword }),
                ...(dto.password !== undefined && { password: dto.password }),
            },
        });
    }

    async delete(id: number): Promise<Instance | null> {
        try {
            return await this.prisma.instances.delete({ where: { id } });
        } catch (err: any) {
            if (err?.code === 'P2025') return null;
            throw err;
        }
    }

    // ── Connection info ───────────────────────────────────────────────────────────

    async getConnectionInfo(instance: Instance): Promise<{ method: string; data: string } | null> {
        const link = await this.prisma.relayInstance.findUnique({ where: { instanceId: instance.id } });
        const relayId = link?.relayId;
        if (!relayId) {
            this.logger.debug(`[getConnectionInfo] Instance ${instance.id} has no relayId`);
            return null;
        }

        // Request status from relay to get address map
        const status = await this.wsGateway.requestStatus(relayId);
        if (!status || !status.a) {
            this.logger.debug(`[getConnectionInfo] No status/address from relay ${relayId} for instance ${instance.id}`);
            return null;
        }

        // Check if instance exists on relay
        const instancesResult = await this.wsGateway.requestInstances(relayId, 1000, 0);
        if (!instancesResult || !instancesResult.instances) {
            this.logger.debug(`[getConnectionInfo] No instances list from relay ${relayId} for instance ${instance.id}`);
            return null;
        }

        const hasInstance = instancesResult.instances.some(i => i.n === instance.id);
        if (!hasInstance) {
            this.logger.debug(`[getConnectionInfo] Instance ${instance.id} not found in relay ${relayId} instances list`);
            return null;
        }

        // Build connection data
        const addresses = Object.entries(status.a).map(([proto, addr]) => `${proto}://${addr}`);
        const connectionData = {
            a: addresses,
            i: instance.id,
            p: status.p ?? 0,
        };

        this.logger.debug(`[getConnectionInfo] Successfully built connection for instance ${instance.id} on relay ${relayId}`);

        return {
            method: 'relay',
            data: Buffer.from(JSON.stringify(connectionData)).toString('base64'),
        };
    }

    // ── Response serializer ───────────────────────────────────────────────────────

    async serialize(instance: Instance) {
        const domain = await this.domain();
        const apiBase = await this.wellKnown.apiBaseUrl();
        const owner = NoxIdentifier.parse(instance.ownerRef);
        const world = NoxIdentifier.parse(instance.worldRef);

        // Get connection info automatically
        const connection = await this.getConnectionInfo(instance);

        // ── Player list ──────────────────────────────────────────────────────────
        let count = 0;
        const players: { user: string | null; display: string }[] = [];
        const relayLink = await this.prisma.relayInstance.findUnique({ where: { instanceId: instance.id } });
        const relayId = relayLink?.relayId;
        if (relayId) {
            // 1. Fetch instances list to resolve internal_id (i) from node master_id (n)
            const instancesResp = await this.wsGateway.requestInstances(relayId, 100, 0);
            const relayInstance = instancesResp?.instances?.find(
                (ri: { n: number }) => ri.n === instance.id,
            ) as { i: number; p: number } | undefined;

            if (relayInstance) {
                count = relayInstance.p;
                // 2. Fetch the first 20 visible players using the internal_id
                const result = await this.wsGateway.requestPlayers(
                    relayId,
                    relayInstance.i,
                    20,
                    0,
                    false
                );
                for (const p of result?.i ?? [])
                    players.push({
                        user: p.u ?? null,
                        display: p.d
                    });
            }
        }
        // ─────────────────────────────────────────────────────────────────────────

        const tags = [
            ...instance.tags,
            ...(instance.capacity === 0 ? ['sys:unlimited'] : []),
            ...(instance.useWhitelist ? ['sys:whitelist'] : []),
            ...(instance.password && instance.usePassword ? ['sys:password'] : []),
        ];

        return {
            id: instance.id,
            name: instance.name,
            title: instance.title ?? null,
            description: instance.description ?? null,
            thumbnail: instance.thumbnail ?? null,
            capacity: instance.capacity,
            server: domain,
            owner: owner.toString(domain),
            world: world.toString(domain),
            tags,
            connection,
            count,
            players,
            alias: [
                { key: 'api', value: `${apiBase}instances/${instance.id}` },
                { key: 'iid', value: `${instance.id}@${domain}` },
                { key: 'nid', value: `${instance.name}@${domain}` },
            ],
        };
    }
}
