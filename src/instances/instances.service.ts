import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { WellKnownService } from '../fediverse/well-known.service';
import { NoxIdentifier } from '../common/identifier';
import { ApiException } from '../api/api-exception';
import { ApiErrorCode } from '../api/api-error.factory';
import type { UserWithMethods } from '../users/user.model';
import { Instance } from 'src/generated/prisma/client';

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

@Injectable()
export class InstancesService {

    private readonly logger = new Logger(InstancesService.name);

    constructor(
        private readonly prisma: PrismaService,
        public readonly wellKnown: WellKnownService,
    ) { }

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

    // ── Response serializer ───────────────────────────────────────────────────────

    async serialize(instance: Instance, connection: { method: string; data: string } | null = null, playerCount = 0, players: { user: string | null; display: string }[] = []) {
        const domain = await this.domain();
        const owner = NoxIdentifier.parse(instance.ownerRef);
        const world = NoxIdentifier.parse(instance.worldRef);

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
            client_count: playerCount,
            players,
        };
    }
}
