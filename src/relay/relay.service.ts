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
import { ExternalUsersService } from '../external/external-users.service';
import { ApiUserDto } from '../users/dto/user-response.dto';
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
    RelayInstanceSettingsChangedDto,
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
    RelayInstanceSettingsChangedEvent,
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

/** Callbacks fired when an instance is unassigned from a relay (receives the instance id). */
const instanceUnassignedHooks: ((id: number) => void)[] = [];

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
        private readonly externalUsers: ExternalUsersService,
        private readonly runners: RunnerFactory,
        @Inject(forwardRef(() => InstancesService))
        private readonly instances: InstancesService,
        @Inject(forwardRef(() => WsGateway))
        private readonly wsGateway: WsGateway,
    ) { }

    async onModuleInit() {
        // Register relay-specific event validators
        this.events.registerValidator('relay_status_change', (s) => this.isRelayAdmin(s));
        this.events.registerValidator('relay_added', (s) => this.isRelayAdmin(s));
        this.events.registerValidator('relay_removed', (s) => this.isRelayAdmin(s));
        this.events.registerValidator('relay_logs', (s) => this.isRelayAdmin(s));
        this.events.registerValidator('relay_specs_update', (s) => this.isRelayAdmin(s));
        this.events.registerValidator('relay_client_connected', (s) => this.isRelayAdmin(s));
        this.events.registerValidator('relay_client_disconnected', (s) => this.isRelayAdmin(s));
        this.events.registerValidator('relay_client_authentified', (s) => this.isRelayAdmin(s));
        this.events.registerValidator('relay_player_join', (s) => this.isRelayAdmin(s));
        this.events.registerValidator('relay_player_leave', (s) => this.isRelayAdmin(s));
        this.events.registerValidator('relay_instance_settings_changed', (s) => this.isRelayAdmin(s));
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
        const rows = await this.prisma.relayInstance.findMany({
            where: { relayId },
            include: { instance: true },
            orderBy: { createdAt: 'asc' },
        });
        return rows.map(r => ({
            id: r.instance.id,
            name: r.instance.name,
            title: r.instance.title,
            worldRef: NoxIdentifier.parse(r.instance.worldRef),
            ownerRef: NoxIdentifier.parse(r.instance.ownerRef),
            capacity: r.instance.capacity,
            createdAt: r.instance.createdAt,
        }));
    }

    async updateTags(id: number, tags: string[]): Promise<RelayWithMethods | null> {
        try {
            const row = await this.prisma.relays.update({
                where: { id },
                data: { tags },
                include: { token: true }
            });
            return this.attachRelay(row);
        } catch (err: any) {
            return null;
        }
    }

    // ── Instance assignment ───────────────────────────────────────────────────────

    async assignInstance(relayId: number, instanceId: number): Promise<boolean> {
        try {
            await this.prisma.relayInstance.upsert({
                where: { instanceId },
                create: { relayId, instanceId },
                update: { relayId },
            });
            this.activity.create({
                type: 'relay.assign_instance',
                message: `Instance #${instanceId} assigned to relay #${relayId}`,
                details: { relay_id: relayId, instance_id: instanceId },
            }).catch(() => { });
            return true;
        } catch (err: any) {
            return false;
        }
    }

    async unassignInstance(instanceId: number): Promise<boolean> {
        try {
            await this.prisma.relayInstance.delete({ where: { instanceId } });
            for (const hook of instanceUnassignedHooks) hook(instanceId);
            return true;
        } catch (err: any) {
            return false;
        }
    }

    // ── Runner lifecycle ──────────────────────────────────────────────────────────

    private async buildStartConfig(relay: RelayWithMethods, maxLink?: number) {
        // Pass the base URL (e.g. https://nox.hactazia.fr/) to the relay
        // The relay will append /api/ws to construct the WebSocket URL
        const nodeGateway = await this.wellKnown.webBaseUrl();

        return {
            relayId: relay.id,
            token: relay.token!.token,
            nodeGateway,
            maxLink: relay.maxLink,
            label: relay.label ?? undefined,
        };
    }

    /** Relay IDs for which startRelay() is currently in progress (container being started). */
    readonly pendingStartRelayIds = new Set<number>();

    async startRelay(id: number, maxLink?: number): Promise<string> {
        const relay = await this.findById(id);
        if (!relay) throw new Error(`Relay (${id}) not found`);
        if (!relay.token) throw new Error(`Relay (${id}) has no authentication token`);

        const runner = this.runners.get(relay.provider);
        const cfg = await this.buildStartConfig(relay, maxLink);

        this.pendingStartRelayIds.add(id);
        try {
            const providerId = await runner.start(cfg);

            const updated = await this.prisma.relays.update({ where: { id }, data: { providerId } });
            if (!updated) throw new Error(`Relay (${id}) was removed while starting`);

            this.logger.log(`Relay #${id} started with provider ID ${providerId}`);
            this.activity.create({ type: 'relay.start', message: `Relay #${id} started`, details: { relay_id: id, provider_id: providerId } }).catch(() => { });
            return providerId;
        } finally {
            this.pendingStartRelayIds.delete(id);
        }
    }

    async stopRelay(id: number, kill: boolean = false): Promise<void> {
        const relay = await this.findById(id);
        if (!relay) throw new Error(`Relay (${id}) not found`);

        const runner = this.runners.get(relay.provider);
        if (relay.providerId) await runner.stop(relay.providerId, kill);

        this.logger.log(`Relay #${id} ${kill ? 'killed' : 'stopped'}`);
        this.activity.create({ type: kill ? 'relay.kill' : 'relay.stop', message: `Relay #${id} ${kill ? 'killed' : 'stopped'}`, details: { relay_id: id } }).catch(() => { });
    }

    async restartRelay(id: number): Promise<void> {
        const relay = await this.findById(id);
        if (!relay) throw new Error(`Relay (${id}) not found`);

        const runner = this.runners.get(relay.provider);
        if (relay.providerId) await runner.restart(relay.providerId);

        this.logger.log(`Relay #${id} restarted`);
        this.activity.create({ type: 'relay.restart', message: `Relay #${id} restarted`, details: { relay_id: id } }).catch(() => { });
    }

    async getRunnerInfo(id: number): Promise<RelayRunnerInfo> {
        const relay = await this.findById(id);
        if (!relay) throw new Error(`Relay (${id}) not found`);

        const runner = this.runners.get(relay.provider);
        return runner.getInfo(relay.providerId ?? null);
    }

    async delete(id: number): Promise<RelayWithMethods | null> {
        // Capture which instances were linked to this relay before Cascade deletes the pairs
        const affected = await this.prisma.relayInstance.findMany({
            where: { relayId: id },
            select: { instanceId: true },
        });
        try {
            const row = await this.prisma.relays.delete({ where: { id } });

            this.logger.log(`Relay #${id} deleted`);
            this.activity.create({
                type: 'relay.delete',
                message: `Relay #${row.id} deleted`,
                details: { relay_id: row.id }
            }).catch(() => { });

            // relay_instances rows deleted via Cascade — fire hooks so instances get re-linked
            for (const { instanceId } of affected)
                for (const hook of instanceUnassignedHooks)
                    hook(instanceId);

            this.events.emit('relay_removed', { relay_id: row.id, time: Date.now() });
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
    /** Register a callback invoked when an instance is unassigned (relayId set to null). */
    onInstanceUnassigned(hook: (instanceId: number) => void) { instanceUnassignedHooks.push(hook); }

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

    getConnectedRelayIds(): number[] {
        return [...new Set(relaySocketMap.values())];
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

        const maxLink = dto.count ?? 3;

        // Persist the relay's self-reported capacity
        await this.prisma.relays.update({ where: { id: relayId }, data: { maxLink } });

        // Get currently assigned instances (oldest first)
        const pairs = await this.prisma.relayInstance.findMany({
            where: { relayId },
            include: { instance: true },
            orderBy: { createdAt: 'asc' },
        });

        // If more pairs than allowed, unlink the most recent ones (fire hooks → re-link elsewhere)
        if (pairs.length > maxLink) {
            const excess = pairs.slice(maxLink);
            for (const pair of excess) {
                await this.prisma.relayInstance.delete({ where: { instanceId: pair.instanceId } });
                for (const hook of instanceUnassignedHooks) hook(pair.instanceId);
            }
        }

        const available = pairs.slice(0, maxLink);

        if (available.length === 0) {
            this.logger.warn(`No instances assigned to relay #${relayId}`);
            return { success: false, error: 'No instances available' };
        }

        const domain = await this.wellKnown.address();
        const slots: RelayInstanceSlot[] = [];
        for (const pair of available) {
            const i = pair.instance;
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

        const domain = await this.wellKnown.address();
        const identifier = new NoxIdentifier(null, String(dto.user_id), dto.server);
        const isExternal = !identifier.isLocal(domain);

        if (isExternal) {
            const externalUser = await this.externalUsers.findOrDiscover(identifier);
            if (!externalUser) return { result: 'invalid_user', error: 'User not found on remote server' };

            const server = await externalUser.server();
            const resp = await server.fetch<{ display: string }>(`/api/users/${dto.user_id}?fp=${encodeURIComponent(dto.fingerprint)}`, { responseClass: ApiUserDto });
            if (resp.error || !resp.data) return { result: 'invalid_user', error: 'Invalid fingerprint' };

            return {
                result: 'success',
                user: {
                    id: dto.user_id,
                    server: dto.server,
                    display: resp.data.display
                }
            };
        }

        const user = await this.prisma.users.findUnique({ where: { id: dto.user_id } });
        if (!user) return { result: 'invalid_user', error: 'User not found' };

        if (user.blacklisted) {
            const bl = user.blacklisted as { reason?: string; expires?: number };
            return { result: 'blacklisted', error: bl?.reason ?? 'You are blacklisted', expire_at: bl?.expires ?? 0 };
        }

        const sessionCount = await this.prisma.sessions.count({
            where: { userId: user.id, fingerprint: dto.fingerprint, expires: { gt: new Date() } },
            take: 1,
        });
        if (sessionCount === 0)
            return {
                result: 'invalid_user',
                error: 'Invalid fingerprint'
            };

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
            time: dto.a,
            level: dto.l,
            message: dto.m,
            tag: dto.t ?? null,
        };
        this.events.emit<RelayLogEntry>('relay_logs', entry);
    }

    handleRelaySpecs(relayId: number, raw: WsRelaySpecs | null) {
        this.events.emit('relay_specs_update', {
            relay_id: relayId, time: Date.now(), details: {
                processor: { used: raw?.c?.u ?? 0, cores: raw?.c?.c ?? 1 },
                memory: { used: raw?.m?.u ?? 0, total: raw?.m?.t ?? 1 },
                upload: { used: raw?.u?.u ?? 0, bandwidth: raw?.u?.b ?? 0, packets: raw?.u?.p ?? 0 },
                download: { used: raw?.d?.u ?? 0, bandwidth: raw?.d?.b ?? 0, packets: raw?.d?.p ?? 0 },
            }
        });
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
                id: dto.id,
                address: dto.address ?? null,
                platform: dto.platform ?? '',
                engine: dto.engine ?? '',
                user: dto.user ?? null,
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
            time: Date.now(),
            client_id: dto.id,
            user: dto.user,
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
            time: Date.now(),
            id: dto.id,
            reason: dto.reason,
            type: dto.type,
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
                client_id: dto.client_id,
                player_id: dto.player_id,
                display: dto.display,
                internal_id: dto.internal_id,
                flags: dto.flags,
                joined_at: dto.joined_at,
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
                player_id: dto.player_id,
                internal_id: dto.internal_id,
                type: dto.type,
                reason: dto.reason,
            },
        };
        this.events.emit<RelayPlayerLeaveEvent>('relay_player_leave', event);
    }

    handleInstanceSettingsChanged(relayId: number, data: unknown) {
        const raw = data as Record<string, unknown> | null | undefined;
        if (!raw || typeof raw.i !== 'number' || typeof raw.t !== 'number' || typeof raw.th !== 'number') {
            this.logger.warn(`Relay #${relayId} sent invalid instance_settings_changed payload: ${JSON.stringify(data)}`);
            return;
        }
        const event: RelayInstanceSettingsChangedEvent = {
            relay_id: relayId,
            time: Date.now(),
            internal_id: raw.i,
            tps: raw.t,
            threshold: raw.th,
        };
        this.events.emit<RelayInstanceSettingsChangedEvent>('relay_instance_settings_changed', event);
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
