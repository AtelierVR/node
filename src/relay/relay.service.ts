import { Injectable, Logger, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PrismaService } from '../database/prisma.service';
import { AppConfigService } from '../config/config.service';
import { EventsService } from '../gateway/events.service';
import { InstancesService } from '../instances/instances.service';
import { WellKnownService } from '../fediverse/well-known.service';
import { ActivityService } from '../activity/activity.service';
import {
    RequestInstancesMessageDto,
    ResolveUserMessageDto,
    SyncInstancesMessageDto,
    RelayLogMessageDto,
    RelayClientEventDto,
    RelayPlayerJoinDto,
    RelayPlayerLeaveDto,
} from './dto/relay-message.dto';
import type { RelayModel } from '../generated/prisma/models/Relay';
import type { RelayTokenModel } from '../generated/prisma/models/RelayToken';
import type { Socket } from 'socket.io';

/** Live runtime state of a relay (polled via Socket.io request/response). */
export interface RelayStatus {
    /** Number of active instances */
    i: number;
    /** Max instances */
    m: number;
    /** Connected QUIC clients */
    c: number;
    /** Engine name (e.g. "rapier") */
    e: string;
    /** Relay software version */
    v: string;
    /** Protocol version */
    p: number;
    /** Uptime in seconds */
    u: number;
    /** Response latency in ms (set by node after round-trip) */
    t?: number;
    /** Hardware specs */
    s: { c: number; m: number; u: number; d: number };
    /** Address map (proto → host:port) */
    a?: Record<string, string>;
}

export interface RelayInstance {
    id: string;
    internal_id: number;
    players: { id: string; client_id: string; display: string; flags: number; user: string | null }[];
    flags: number;
    world: string;
    capacity: number;
}

export interface RelayClient {
    id: string;
    address: string;
    platform: string;
    engine: string;
    user: string | null;
}

/** Map of socketId → relayId for connected relays. */
const relaySocketMap = new Map<string, number>();

@Injectable()
export class RelayService implements OnModuleInit {

    private readonly logger = new Logger(RelayService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly config: AppConfigService,
        private readonly events: EventsService,
        private readonly wellKnown: WellKnownService,
        private readonly activity: ActivityService,
        @Inject(forwardRef(() => InstancesService))
        private readonly instances: InstancesService,
    ) { }

    async onModuleInit() {
        // Register relay-specific event validators
        this.events.registerValidator('relay_status_change', (s) => this.isRelayAdmin(s));
        this.events.registerValidator('relay_logs', (s) => this.isRelayAdmin(s));
        this.events.registerValidator('relay_specs_update', (s) => this.isRelayAdmin(s));
        this.events.registerValidator('relay_client_connected', (s) => this.isRelayAdmin(s));
        this.events.registerValidator('relay_client_disconnected', (s) => this.isRelayAdmin(s));
        this.events.registerValidator('relay_player_join', (s) => this.isRelayAdmin(s));
        this.events.registerValidator('relay_player_leave', (s) => this.isRelayAdmin(s));
    }

    private async isRelayAdmin(socket: Socket): Promise<boolean> {
        return !!(socket.data?.user?.isAdmin?.());
    }

    // ── Relay CRUD ───────────────────────────────────────────────────────────────

    async findAll(): Promise<(RelayModel & { token: RelayTokenModel | null })[]> {
        return this.prisma.relays.findMany({ include: { token: true } });
    }

    async findById(id: number): Promise<(RelayModel & { token: RelayTokenModel | null }) | null> {
        return this.prisma.relays.findUnique({ where: { id }, include: { token: true } });
    }

    async findByToken(token: string): Promise<(RelayModel & { token: RelayTokenModel | null }) | null> {
        const relayToken = await this.prisma.relayTokens.findUnique({
            where: { token },
            include: { relay: { include: { token: true } } },
        });
        return relayToken?.relay ?? null;
    }

    async create(): Promise<RelayModel & { token: RelayTokenModel }> {
        const token = randomBytes(64).toString('base64');
        const relay = await this.prisma.relays.create({
            data: { token: { create: { token } } },
            include: { token: true },
        }) as RelayModel & { token: RelayTokenModel };
        this.activity.create({ 
            type: 'relay.create', 
            message: `Relay #${relay.id} created`, 
            details: { relay_id: relay.id } 
        }).catch(() => { });
        return relay;
    }

    async delete(id: number): Promise<RelayModel | null> {
        try {
            const relay = await this.prisma.relays.delete({ where: { id } });
            this.activity.create({ 
                type: 'relay.delete', 
                message: `Relay #${relay.id} deleted`, 
                details: { relay_id: relay.id } 
            }).catch(() => { });
            return relay;
        } catch (err: any) {
            if (err?.code === 'P2025') return null;
            throw err;
        }
    }

    // ── Socket tracking ───────────────────────────────────────────────────────────

    getRelayId(socketId: string): number | undefined {
        return relaySocketMap.get(socketId);
    }

    registerSocket(socketId: string, relayId: number) {
        relaySocketMap.set(socketId, relayId);
        this.logger.log(`Relay #${relayId} connected (socket ${socketId})`);
    }

    unregisterSocket(socketId: string) {
        const relayId = relaySocketMap.get(socketId);
        if (relayId !== undefined) {
            relaySocketMap.delete(socketId);
            this.logger.log(`Relay #${relayId} disconnected (socket ${socketId})`);
        }
    }

    getSocketsForRelay(relayId: number): string[] {
        const result: string[] = [];
        for (const [sid, rid] of relaySocketMap) {
            if (rid === relayId) result.push(sid);
        }
        return result;
    }

    isRelayConnected(relayId: number): boolean {
        return this.getSocketsForRelay(relayId).length > 0;
    }

    // ── Address resolution ────────────────────────────────────────────────────────

    async resolveDockerAddress(): Promise<string> {
        return (await this.config.getOptional<string>('relay.docker_address')) ?? '127.0.0.1';
    }

    resolveAddresses(rawMap: Record<string, string>, dockerAddress: string): Record<string, string> {
        return Object.fromEntries(
            Object.entries(rawMap).map(([proto, addr]) => [
                proto.toLowerCase(),
                addr.replace(/^(0\.0\.0\.0:|::1:|:::)/, `${dockerAddress}:`),
            ]),
        );
    }

    // ── Relay message: request_instances ─────────────────────────────────────────

    async handleRequestInstances(relayId: number, data: unknown): Promise<object> {
        const dto = plainToInstance(RequestInstancesMessageDto, data ?? {});
        const errors = validateSync(dto);
        if (errors.length > 0) return { success: false, error: 'Invalid payload' };

        const count = dto.count ?? 1;
        const available = await this.prisma.instances.findMany({ orderBy: { createdAt: 'asc' }, take: count });

        if (available.length === 0) {
            this.logger.warn(`No available instances for relay #${relayId}`);
            return { success: false, error: 'No available instances' };
        }

        const domain = await this.wellKnown.address();
        const assigned = available.map(i => ({
            id: i.id,
            password: i.password,
            capacity: i.capacity,
            world: { id: i.worldRef, address: domain, version: 0 },
        }));

        this.logger.log(`Assigning ${assigned.length} instance(s) to relay #${relayId}`);
        return { success: true, instances: assigned };
    }

    // ── Relay message: resolve_user ───────────────────────────────────────────────

    async handleResolveUser(relayId: number, data: unknown): Promise<object> {
        const dto = plainToInstance(ResolveUserMessageDto, data ?? {});
        const errors = validateSync(dto);
        if (errors.length > 0) return { result: 'invalid_user', error: 'Missing or invalid user_id' };

        const user = await this.prisma.users.findUnique({ where: { id: dto.user_id } });
        if (!user) return { result: 'invalid_user', error: 'User not found' };

        if (user.blacklisted) {
            const bl = user.blacklisted as { reason?: string; expires?: number };
            return { result: 'blacklisted', error: bl?.reason ?? 'You are blacklisted', expire_at: bl?.expires ?? 0 };
        }

        const domain = await this.wellKnown.address();
        return { result: 'success', user: { id: user.id, server: domain, display: user.display } };
    }

    // ── Relay message: relay_sync_instances ───────────────────────────────────────

    async handleSyncInstances(relayId: number, data: unknown): Promise<object> {
        const dto = plainToInstance(SyncInstancesMessageDto, data ?? {});
        const errors = validateSync(dto, { whitelist: true });
        if (errors.length > 0) return { success: false, error: 'Invalid payload' };

        const instanceIds = dto.instances.map(i => i.node_id).filter(id => id > 0);

        const existing = await this.prisma.instances.findMany({ where: { id: { in: instanceIds } } });
        const validIds = existing.map(i => i.id);
        const invalidIds = instanceIds.filter(id => !validIds.includes(id));

        if (validIds.length > 0) {
            await this.prisma.instances.updateMany({
                where: { id: { in: validIds } },
                data: { updatedAt: new Date() },
            });
        }

        this.logger.log(`Relay #${relayId} synced ${validIds.length} instances (${invalidIds.length} invalid)`);

        this.events.emit('relay_status_change', { relay_id: relayId, status: 'ready', time: Date.now() });

        return {
            success: true,
            synced_count: validIds.length,
            invalid_instances: invalidIds.length > 0 ? invalidIds : null,
            conflicts_resolved: 0,
        };
    }

    // ── Relay log / specs forwarding ──────────────────────────────────────────────

    handleRelayLog(relayId: number, data: unknown) {
        const dto = plainToInstance(RelayLogMessageDto, data ?? {});
        const errors = validateSync(dto);
        if (errors.length > 0) {
            this.logger.warn(`Relay #${relayId} sent invalid log entry`);
            return;
        }
        this.events.emit('relay_logs', {
            relay_id: relayId,
            time:    dto.a,
            level:   dto.l,
            message: dto.m,
            tag:     dto.t ?? null,
        });
    }

    handleRelaySpecs(relayId: number, data: unknown) {
        this.events.emit('relay_specs_update', { relay_id: relayId, time: Date.now(), details: data });
    }

    handleClientConnected(relayId: number, data: unknown) {
        const dto = plainToInstance(RelayClientEventDto, data ?? {});
        const errors = validateSync(dto);
        if (errors.length > 0) {
            this.logger.warn(`Relay #${relayId} sent invalid client_connected payload`);
            return;
        }
        this.events.emit('relay_client_connected', {
            relay_id: relayId,
            time: Date.now(),
            client: { id: dto.id, address: dto.address ?? null },
        });
    }

    handleClientDisconnected(relayId: number, data: unknown) {
        const dto = plainToInstance(RelayClientEventDto, data ?? {});
        const errors = validateSync(dto);
        if (errors.length > 0) {
            this.logger.warn(`Relay #${relayId} sent invalid client_disconnected payload`);
            return;
        }
        this.events.emit('relay_client_disconnected', {
            relay_id: relayId,
            time: Date.now(),
            client: { id: dto.id, address: dto.address ?? null, user: dto.user ?? null },
        });
    }

    handlePlayerJoin(relayId: number, data: unknown) {
        const dto = plainToInstance(RelayPlayerJoinDto, data ?? {});
        const errors = validateSync(dto);
        if (errors.length > 0) {
            this.logger.warn(`Relay #${relayId} sent invalid player_join payload`);
            return;
        }
        this.events.emit('relay_player_join', {
            relay_id: relayId,
            time: Date.now(),
            player: {
                client_id:   dto.client_id,
                player_id:   dto.player_id,
                instance_id: dto.instance_id,
                user:        dto.user ?? null,
                display:     dto.display,
            },
        });
    }

    handlePlayerLeave(relayId: number, data: unknown) {
        const dto = plainToInstance(RelayPlayerLeaveDto, data ?? {});
        const errors = validateSync(dto);
        if (errors.length > 0) {
            this.logger.warn(`Relay #${relayId} sent invalid player_leave payload`);
            return;
        }
        this.events.emit('relay_player_leave', {
            relay_id: relayId,
            time: Date.now(),
            player: {
                client_id:   dto.client_id,
                player_id:   dto.player_id,
                instance_id: dto.instance_id,
                user:        dto.user ?? null,
            },
        });
    }

    handleRelayConnected(relayId: number) {
        this.logger.log(`Relay #${relayId} socket authenticated`);
        this.events.emit('relay_status_change', {
            relay_id: relayId,
            status: 'connected',
            time: Date.now(),
        });
    }

    handleRelayDisconnected(relayId: number) {
        this.logger.log(`Relay #${relayId} socket disconnected`);
        this.events.emit('relay_status_change', {
            relay_id: relayId,
            status: 'disconnected',
            time: Date.now(),
        });
    }

    // ── Docker control (delegated to gateway) ────────────────────────────────────

    /**
     * Stop a relay — sends a 'stop' command via socket.
     * Returns false if the relay is not connected.
     */
    async stopRelay(relayId: number): Promise<boolean> {
        if (!this.isRelayConnected(relayId)) return false;
        // The gateway needs to be imported here; to avoid circular deps we let
        // the controller call gateway.sendCommand directly.
        return true;
    }

    /**
     * Restart a relay — sends a 'restart' command via socket.
     * Returns false if the relay is not connected.
     */
    async restartRelay(relayId: number): Promise<boolean> {
        if (!this.isRelayConnected(relayId)) return false;
        return true;
    }
}
