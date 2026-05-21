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
import { NoxIdentifier } from '../common/identifier';
import { RunnerFactory } from './runners/runner.factory';
import type { RelayRunnerInfo } from './runners/runner.interface';
import {
    RequestInstancesMessageDto,
    ResolveUserMessageDto,
    SyncInstancesMessageDto,
    RelayLogMessageDto,
    RelayClientEventDto,
    RelayClientAuthentifiedDto,
    RelayClientDisconnectedDto,
    RelayPlayerJoinDto,
    RelayPlayerLeaveDto,
} from './dto/relay-message.dto';
import type { RelayModel } from '../generated/prisma/models/Relay';
import type { RelayTokenModel } from '../generated/prisma/models/RelayToken';
import type { Socket } from 'socket.io';
import { Relay } from './relay.model';
import type { RelayWithMethods, RelayWithMethodsAndToken } from './relay.model';
import type {
    RelayAssignedInstance,
    RelayInstanceSlot,
    RelayResolvedUser,
    RelayLogEntry,
    RelayClientEvent,
    RelayClientAuthentifiedEvent,
    RelayClientDisconnectedEvent,
    RelayPlayerJoinEvent,
    RelayPlayerLeaveEvent,
    RelayStatusChangeEvent,
    WsRelaySpecs
} from './relay.types';
import { WsGateway } from '../ws/ws.gateway';

/** Map of socketId → relayId for connected relays. */
const relaySocketMap = new Map<string, number>();

/** Connect / disconnect lifecycle hooks registered by RelayAutoManager. */
type RelayLifecycleHook = (relayId: number) => void;
const connectHooks: RelayLifecycleHook[] = [];
const disconnectHooks: RelayLifecycleHook[] = [];

@Injectable()
export class RelayService implements OnModuleInit {

    address() {
        return this.wellKnown.address();
    }

    private readonly logger = new Logger(RelayService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly config: AppConfigService,
        private readonly events: EventsService,
        private readonly wellKnown: WellKnownService,
        private readonly activity: ActivityService,
        private readonly runners: RunnerFactory,
        @Inject(forwardRef(() => InstancesService))
        private readonly instances: InstancesService,
        @Inject(forwardRef(() => WsGateway))
        private readonly wsGateway: WsGateway,
    ) { }

    async onModuleInit() {
        // Register relay-specific event validators
        this.events.registerValidator('relay_status_change', (s) => this.isRelayAdmin(s));
        this.events.registerValidator('relay_logs', (s) => this.isRelayAdmin(s));
        this.events.registerValidator('relay_specs_update', (s) => this.isRelayAdmin(s));
        this.events.registerValidator('relay_client_connected', (s) => this.isRelayAdmin(s));
        this.events.registerValidator('relay_client_disconnected', (s) => this.isRelayAdmin(s));
        this.events.registerValidator('relay_client_authentified', (s) => this.isRelayAdmin(s));
        this.events.registerValidator('relay_player_join', (s) => this.isRelayAdmin(s));
        this.events.registerValidator('relay_player_leave', (s) => this.isRelayAdmin(s));
    }

    private async isRelayAdmin(socket: Socket): Promise<boolean> {
        return !!(socket.data?.user?.isAdmin?.());
    }

    // ── Relay CRUD ───────────────────────────────────────────────────────────────

    private attachRelay(model: RelayModel & { token?: RelayTokenModel | null }): RelayWithMethods {
        return Relay.attach(model, this, this.wsGateway);
    }

    async findAll(): Promise<RelayWithMethods[]> {
        const rows = await this.prisma.relays.findMany({ include: { token: true } });
        return rows.map(r => this.attachRelay(r));
    }

    async findById(id: number): Promise<RelayWithMethods | null> {
        const row = await this.prisma.relays.findUnique({ where: { id }, include: { token: true } });
        return row ? this.attachRelay(row) : null;
    }

    async findByToken(token: string): Promise<RelayWithMethods | null> {
        const relayToken = await this.prisma.relayTokens.findUnique({
            where: { token },
            include: { relay: { include: { token: true } } },
        });
        return relayToken?.relay ? this.attachRelay(relayToken.relay) : null;
    }

    async create(opts?: { label?: string; provider?: string; tags?: string[] }): Promise<RelayWithMethodsAndToken> {
        const token = randomBytes(64).toString('base64');
        const relay = await this.prisma.relays.create({
            data: {
                token: { create: { token } },
                label: opts?.label ?? null,
                provider: opts?.provider ?? 'docker',
                tags: opts?.tags ?? [],
            },
            include: { token: true },
        }) as RelayModel & { token: RelayTokenModel };
        this.activity.create({ 
            type: 'relay.create', 
            message: `Relay #${relay.id} created`, 
            details: { relay_id: relay.id, provider: relay.provider } 
        }).catch(() => { });
        return Relay.attach(relay, this, this.wsGateway) as RelayWithMethodsAndToken;
    }

    // ── Tags ──────────────────────────────────────────────────────────────────────

    async getAssignedInstances(relayId: number): Promise<RelayAssignedInstance[]> {
        const rows = await this.prisma.instances.findMany({
            where: { relayId },
            select: { id: true, name: true, title: true, worldRef: true, ownerRef: true, capacity: true, createdAt: true },
            orderBy: { createdAt: 'asc' },
        });
        return rows.map(r => ({
            id: r.id,
            name: r.name,
            title: r.title,
            worldRef: NoxIdentifier.parse(r.worldRef),
            ownerRef: NoxIdentifier.parse(r.ownerRef),
            capacity: r.capacity,
            createdAt: r.createdAt,
        }));
    }

    async updateTags(id: number, tags: string[]): Promise<RelayWithMethods | null> {
        try {
            const row = await this.prisma.relays.update({ where: { id }, data: { tags }, include: { token: true } });
            return this.attachRelay(row);
        } catch (err: any) {
            if (err?.code === 'P2025') return null;
            throw err;
        }
    }

    // ── Instance assignment ───────────────────────────────────────────────────────

    async assignInstance(relayId: number, instanceId: number): Promise<boolean> {
        try {
            await this.prisma.instances.update({
                where: { id: instanceId },
                data: { relayId },
            });
            this.activity.create({
                type: 'relay.assign_instance',
                message: `Instance #${instanceId} assigned to relay #${relayId}`,
                details: { relay_id: relayId, instance_id: instanceId },
            }).catch(() => { });
            return true;
        } catch (err: any) {
            if (err?.code === 'P2025') return false;
            throw err;
        }
    }

    async unassignInstance(instanceId: number): Promise<boolean> {
        try {
            await this.prisma.instances.update({
                where: { id: instanceId },
                data: { relayId: null },
            });
            return true;
        } catch (err: any) {
            if (err?.code === 'P2025') return false;
            throw err;
        }
    }

    // ── Runner lifecycle ──────────────────────────────────────────────────────────

    private async buildStartConfig(relay: RelayWithMethods, maxInstances?: number) {
        // Pass the base URL (e.g. https://nox.hactazia.fr/) to the relay
        // The relay will append /api/ws to construct the WebSocket URL
        const nodeGateway = await this.wellKnown.webBaseUrl();

        return {
            relayId: relay.id,
            token: relay.token!.token,
            nodeGateway,
            maxInstances: maxInstances ?? Number(await this.config.getOptional<number>('relay.max_instances') ?? 3),
            label: relay.label ?? undefined,
        };
    }

    async startRelay(id: number, maxInstances?: number): Promise<string> {
        const relay = await this.findById(id);
        if (!relay) throw new Error(`Relay (${id}) not found`);
        if (!relay.token) throw new Error(`Relay (${id}) has no authentication token`);

        const runner = this.runners.get(relay.provider);
        const cfg = await this.buildStartConfig(relay, maxInstances);
        const providerId = await runner.start(cfg);

        await this.prisma.relays.update({ where: { id }, data: { providerId } });
        this.activity.create({ type: 'relay.start', message: `Relay #${id} started`, details: { relay_id: id, provider_id: providerId } }).catch(() => { });
        return providerId;
    }

    async stopRelay(id: number): Promise<void> {
        const relay = await this.findById(id);
        if (!relay) throw new Error(`Relay (${id}) not found`);

        const runner = this.runners.get(relay.provider);
        if (relay.providerId) await runner.stop(relay.providerId);

        this.activity.create({ type: 'relay.stop', message: `Relay #${id} stopped`, details: { relay_id: id } }).catch(() => { });
    }

    async restartRelay(id: number): Promise<string> {
        const relay = await this.findById(id);
        if (!relay) throw new Error(`Relay (${id}) not found`);
        if (!relay.token) throw new Error(`Relay (${id}) has no authentication token`);

        const runner = this.runners.get(relay.provider);
        const cfg = await this.buildStartConfig(relay);
        const newProviderId = await runner.restart(relay.providerId ?? '', cfg);

        await this.prisma.relays.update({ where: { id }, data: { providerId: newProviderId } });
        this.activity.create({ type: 'relay.restart', message: `Relay #${id} restarted`, details: { relay_id: id, provider_id: newProviderId } }).catch(() => { });
        return newProviderId;
    }

    async killRelay(id: number): Promise<void> {
        const relay = await this.findById(id);
        if (!relay) throw new Error(`Relay (${id}) not found`);

        const runner = this.runners.get(relay.provider);
        if (relay.providerId) await runner.kill(relay.providerId);

        this.activity.create({ type: 'relay.kill', message: `Relay #${id} killed`, details: { relay_id: id } }).catch(() => { });
    }

    async getRunnerInfo(id: number): Promise<RelayRunnerInfo> {
        const relay = await this.findById(id);
        if (!relay) throw new Error(`Relay (${id}) not found`);

        const runner = this.runners.get(relay.provider);
        return runner.getInfo(relay.providerId ?? null);
    }

    async delete(id: number): Promise<RelayWithMethods | null> {
        try {
            const row = await this.prisma.relays.delete({ where: { id } });
            this.activity.create({ 
                type: 'relay.delete', 
                message: `Relay #${row.id} deleted`, 
                details: { relay_id: row.id } 
            }).catch(() => { });
            return this.attachRelay(row);
        } catch (err: any) {
            if (err?.code === 'P2025') return null;
            throw err;
        }
    }

    registerSocket(socketId: string, relayId: number) {
        relaySocketMap.set(socketId, relayId);
        this.handleRelayConnected(relayId);
    }

    unregisterSocket(socketId: string) {
        this.handleSocketDisconnect(socketId);
        const relayId = relaySocketMap.get(socketId);
        if (relayId !== undefined) 
            this.handleRelayDisconnected(relayId);
    }

    handleSocketDisconnect(socketId: string) {
        const relayId = relaySocketMap.get(socketId);
        if (relayId !== undefined) {
            relaySocketMap.delete(socketId);
            this.logger.log(`Relay #${relayId} disconnected (socket ${socketId})`);
        }
    }

    /** Register a callback invoked when any relay connects. */
    onConnect(hook: (relayId: number) => void) { connectHooks.push(hook); }
    /** Register a callback invoked when any relay disconnects. */
    onDisconnect(hook: (relayId: number) => void) { disconnectHooks.push(hook); }

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

    async handleRequestInstances(relayId: number, data: unknown): Promise<{ success: boolean; error?: string; instances?: RelayInstanceSlot[] }> {
        const dto = plainToInstance(RequestInstancesMessageDto, data ?? {});
        const errors = validateSync(dto);
        if (errors.length > 0) return { success: false, error: 'Invalid payload' };

        const count = dto.count ?? 1;

        // First: instances already assigned to this relay
        const alreadyAssigned = await this.prisma.instances.findMany({
            where: { relayId },
            orderBy: { createdAt: 'asc' },
        });

        // Second: unassigned instances (relayId = null) to fill up to `count`
        const remaining = count - alreadyAssigned.length;
        const unassigned = remaining > 0
            ? await this.prisma.instances.findMany({
                where: { relayId: null },
                orderBy: { createdAt: 'asc' },
                take: remaining,
            })
            : [];

        // Auto-assign the unassigned ones to this relay
        if (unassigned.length > 0) {
            const ids = unassigned.map(i => i.id);
            await this.prisma.instances.updateMany({ where: { id: { in: ids } }, data: { relayId } });
            this.logger.log(`Auto-assigned ${ids.length} instance(s) to relay #${relayId}: [${ids.join(', ')}]`);
        }

        const available = [...alreadyAssigned, ...unassigned];

        if (available.length === 0) {
            this.logger.warn(`No instances available for relay #${relayId}`);
            return { success: false, error: 'No instances available' };
        }

        const domain = await this.wellKnown.address();
        const slots: RelayInstanceSlot[] = [];
        for (const i of available) {
            const worldNi = NoxIdentifier.parse(i.worldRef);
            const worldId = worldNi.numericId;
            if (!worldId) {
                this.logger.error(`Instance #${i.id} has invalid worldRef: ${i.worldRef}`);
                continue;
            }
            const rawVersion = worldNi.query['v'];
            const worldVersion = rawVersion !== undefined ? parseInt(rawVersion, 10) : 65535;
            const version = Number.isInteger(worldVersion) && worldVersion >= 0 && worldVersion <= 65535
                ? worldVersion : 65535;
            slots.push({
                id: i.id,
                password: i.password,
                capacity: i.capacity,
                world: { id: worldId, address: domain, version },
            });
        }

        this.logger.log(`Sending ${slots.length} instance(s) to relay #${relayId}`);
        return { success: true, instances: slots };
    }

    // ── Relay message: resolve_user ───────────────────────────────────────────────

    async handleResolveUser(relayId: number, data: unknown): Promise<RelayResolvedUser> {
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

    async handleSyncInstances(relayId: number, data: unknown): Promise<{ success: boolean; error?: string; synced_count?: number; invalid_instances?: number[] | null; conflicts_resolved?: number }> {
        const dto = plainToInstance(SyncInstancesMessageDto, data ?? {});
        const errors = validateSync(dto, { whitelist: true });
        if (errors.length > 0) return { success: false, error: 'Invalid payload' };

        const instanceIds = dto.instances.map(i => i.master_id).filter(id => id > 0);

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

        this.events.emit<RelayStatusChangeEvent>('relay_status_change', { relay_id: relayId, status: 'ready', time: Date.now() });

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
        const entry: RelayLogEntry = {
            relay_id: relayId,
            time:    dto.a,
            level:   dto.l,
            message: dto.m,
            tag:     dto.t ?? null,
        };
        this.events.emit<RelayLogEntry>('relay_logs', entry);
    }

    handleRelaySpecs(relayId: number, raw: WsRelaySpecs | null) {
        this.events.emit('relay_specs_update', { relay_id: relayId, time: Date.now(), details: {
            processor: { used: raw?.c?.u ?? 0, cores: raw?.c?.c ?? 1 },
            memory:    { used: raw?.m?.u ?? 0, total: raw?.m?.t ?? 1 },
            upload:    { used: raw?.u?.u ?? 0, bandwidth: raw?.u?.b ?? 0, packets: raw?.u?.p ?? 0 },
            download:  { used: raw?.d?.u ?? 0, bandwidth: raw?.d?.b ?? 0, packets: raw?.d?.p ?? 0 },
        } });
    }

    handleClientConnected(relayId: number, data: unknown) {
        const dto = plainToInstance(RelayClientEventDto, data ?? {});
        const errors = validateSync(dto);
        if (errors.length > 0) {
            this.logger.warn(`Relay #${relayId} sent invalid client_connected payload`);
            return;
        }
        const event: RelayClientEvent = {
            relay_id: relayId,
            time: Date.now(),
            client: {
                id:           dto.id,
                address:      dto.address  ?? null,
                platform:     dto.platform ?? '',
                engine:       dto.engine   ?? '',
                user:         dto.user     ?? null,
                connected_at: dto.connected_at ?? Date.now(),
            },
        };
        this.events.emit<RelayClientEvent>('relay_client_connected', event);
    }

    handleClientAuthentified(relayId: number, data: unknown) {
        const dto = plainToInstance(RelayClientAuthentifiedDto, data ?? {});
        const errors = validateSync(dto);
        if (errors.length > 0) {
            this.logger.warn(`Relay #${relayId} sent invalid client_authentified payload`);
            return;
        }
        const event: RelayClientAuthentifiedEvent = {
            relay_id: relayId,
            time:      Date.now(),
            client_id: dto.id,
            user:      dto.user,
        };
        this.events.emit<RelayClientAuthentifiedEvent>('relay_client_authentified', event);
    }

    handleClientDisconnected(relayId: number, data: unknown) {
        const dto = plainToInstance(RelayClientDisconnectedDto, data ?? {});
        const errors = validateSync(dto);
        if (errors.length > 0) {
            this.logger.warn(`Relay #${relayId} sent invalid client_disconnected payload`);
            return;
        }
        const event: RelayClientDisconnectedEvent = {
            relay_id: relayId,
            time:     Date.now(),
            id:       dto.id,
            reason:   dto.reason,
            type:     dto.type,
        };
        this.events.emit<RelayClientDisconnectedEvent>('relay_client_disconnected', event);
    }

    handlePlayerJoin(relayId: number, data: unknown) {
        const dto = plainToInstance(RelayPlayerJoinDto, data ?? {});
        const errors = validateSync(dto);
        if (errors.length > 0) {
            this.logger.warn(`Relay #${relayId} sent invalid player_join payload`);
            return;
        }
        const event: RelayPlayerJoinEvent = {
            relay_id: relayId,
            time: Date.now(),
            player: {
                client_id:   dto.client_id,
                player_id:   dto.player_id,
                display:     dto.display,
                internal_id: dto.internal_id,
                flags:       dto.flags,
                joined_at:   dto.joined_at,
            },
        };
        this.events.emit<RelayPlayerJoinEvent>('relay_player_join', event);
    }

    handlePlayerLeave(relayId: number, data: unknown) {
        const dto = plainToInstance(RelayPlayerLeaveDto, data ?? {});
        const errors = validateSync(dto);
        if (errors.length > 0) {
            this.logger.warn(`Relay #${relayId} sent invalid player_leave payload`);
            return;
        }
        const event: RelayPlayerLeaveEvent = {
            relay_id: relayId,
            time: Date.now(),
            player: {
                player_id:   dto.player_id,
                internal_id: dto.internal_id,
                type:        dto.type,
                reason:      dto.reason,
            },
        };
        this.events.emit<RelayPlayerLeaveEvent>('relay_player_leave', event);
    }

    handleRelayConnected(relayId: number) {
        this.logger.log(`Relay #${relayId} socket authenticated`);
        for (const hook of connectHooks) hook(relayId);
        const event: RelayStatusChangeEvent = { relay_id: relayId, status: 'connected', time: Date.now() };
        this.events.emit<RelayStatusChangeEvent>('relay_status_change', event);
    }

    handleRelayDisconnected(relayId: number) {
        this.logger.log(`Relay #${relayId} socket disconnected`);
        for (const hook of disconnectHooks) hook(relayId);
        const event: RelayStatusChangeEvent = { relay_id: relayId, status: 'disconnected', time: Date.now() };
        this.events.emit<RelayStatusChangeEvent>('relay_status_change', event);
    }
}
