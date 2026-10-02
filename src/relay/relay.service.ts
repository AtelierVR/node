import { Injectable, Logger, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PrismaService } from '../database/prisma.service';
import { AppConfigService } from '../config/config.service';
import { EmitterService } from '../events/emitter.service';
import { Events } from '../events/domain-events';
import { OnWebsocketEventRegister } from '../events/websocket-event.decorator';
import { WsFrames } from '../events/websocket-frames';
import type {
    ApiWsRelayClientAuthentified,
    ApiWsRelayClientConnected,
    ApiWsRelayClientDisconnected,
    ApiWsRelayInstanceAssignment,
    ApiWsRelayLog,
    ApiWsRelayPlayerJoin,
    ApiWsRelayPlayerLeave,
    ApiWsRelayRemoved,
    ApiWsRelaySpecs,
    ApiWsRelayStatus,
} from '../events/websocket-frames';
import { WsService } from '../ws/ws.service';
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
    RelaySpecsMessageDto,
} from './dto/relay-message.dto';
import type { RelayModel } from '../generated/prisma/models/Relay';
import type { RelayTokenModel } from '../generated/prisma/models/RelayToken';
import type { Socket } from 'socket.io';
import { Relay } from './relay.model';
import { InstanceLifecycle } from '../instances/lifecycle/lifecycle.registry';
import { RelayLifecycle } from './lifecycle/lifecycle.registry';
import type { RelayWithMethods, RelayWithMethodsAndToken } from './relay.model';
import type {
    ApiRelayLifecycle,
    RelayAssignedInstance,
    RelayInstanceSlot,
    RelayResolvedUser,
    RelayLogFrame,
    RelayClientFrame,
    RelayClientAuthentifiedFrame,
    RelayClientDisconnectedFrame,
    RelayPlayerJoinFrame,
    RelayPlayerLeaveFrame,
    RelayInstanceSettingsFrame,
} from './relay.types';
import type {
    RelayLifecycleChangeEvent,
    RelayStatusChangeEvent,
    RelaySpecsUpdateEvent,
    RelayCreatedEvent,
    RelayRemovedEvent,
    RelayInstanceAssignmentEvent,
} from '../events/domain-events';
import { WsGateway } from '../ws/ws.gateway';

/** Map of socketId → relayId for connected relays. */
const relaySocketMap = new Map<string, number>();

@Injectable()
export class RelayService implements OnModuleInit {

    address() {
        return this.wellKnown.address();
    }

    private readonly logger = new Logger(RelayService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly config: AppConfigService,
        private readonly emitter: EmitterService,
        private readonly wellKnown: WellKnownService,
        private readonly activity: ActivityService,
        private readonly externalUsers: ExternalUsersService,
        private readonly runners: RunnerFactory,
        /**
         * Owner of the instance cleanup state (grace deadlines, idle timers).
         *
         * Exposed here because the relay module already depends on this service, while whoever
         * *reports* the lifecycle (the instance serializer) must not have to reach into `logics/`:
         * it reads the state, it never owns it.
         */
        public readonly instanceLifecycle: InstanceLifecycle,
        public readonly relayLifecycle: RelayLifecycle,
        @Inject(forwardRef(() => WsGateway))
        private readonly wsGateway: WsGateway,
        private readonly ws: WsService,
    ) { }

    // ── Client-facing frames ─────────────────────────────────────────────────────
    // The internal `emitter.emit` next to a change stays invisible to browsers; each frame below is
    // pushed explicitly through `ws.emit`, so "what clients see" is a deliberate, readable list.
    // The guard below is what the gateways call when a socket tries to subscribe to any of them.

    @OnWebsocketEventRegister(WsFrames.RELAY_CREATED)
    @OnWebsocketEventRegister(WsFrames.RELAY_REMOVED)
    @OnWebsocketEventRegister(WsFrames.RELAY_STATUS)
    @OnWebsocketEventRegister(WsFrames.RELAY_LIFECYCLE)
    @OnWebsocketEventRegister(WsFrames.RELAY_LOGS)
    @OnWebsocketEventRegister(WsFrames.RELAY_SPECS)
    @OnWebsocketEventRegister(WsFrames.RELAY_INSTANCE_ASSIGNED)
    @OnWebsocketEventRegister(WsFrames.RELAY_INSTANCE_UNASSIGNED)
    @OnWebsocketEventRegister(WsFrames.RELAY_INSTANCE_SETTINGS)
    @OnWebsocketEventRegister(WsFrames.RELAY_CLIENT_CONNECTED)
    @OnWebsocketEventRegister(WsFrames.RELAY_CLIENT_AUTHENTIFIED)
    @OnWebsocketEventRegister(WsFrames.RELAY_CLIENT_DISCONNECTED)
    @OnWebsocketEventRegister(WsFrames.RELAY_PLAYER_JOIN)
    @OnWebsocketEventRegister(WsFrames.RELAY_PLAYER_LEAVE)
    private registerRelayFrame(socket: Socket): Promise<boolean> {
        return this.isRelayAdmin(socket);
    }

    async onModuleInit() {
        // Nothing to wire here: every cross-service reaction is an `@OnEvent` subscription, and
        // client frames are published explicitly through `WsService`.
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
            tags: r.instance.tags,
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
            // A move touches two relays: the one gaining the instance and the one losing it.
            const previous = await this.prisma.relayInstance.findUnique({ where: { instanceId } });

            await this.prisma.relayInstance.upsert({
                where: { instanceId },
                create: { relayId, instanceId },
                update: { relayId },
            });
            // Freeze the idle timer: the instance is not hosted by its new relay yet, so a zero
            // player count must not be read as "empty".
            const assigned: RelayInstanceAssignmentEvent = { relay_id: relayId, instance_id: instanceId, action: 'assigned', time: Date.now() };
            this.emitter.emit(Events.RELAY_INSTANCE_ASSIGNED, assigned);
            this.ws.emit(WsFrames.RELAY_INSTANCE_ASSIGNED, { ...assigned });
            if (previous && previous.relayId !== relayId) {
                const unassigned: RelayInstanceAssignmentEvent = { relay_id: previous.relayId, instance_id: instanceId, action: 'unassigned', time: Date.now() };
                this.emitter.emit(Events.RELAY_INSTANCE_UNASSIGNED, unassigned);
                this.ws.emit(WsFrames.RELAY_INSTANCE_UNASSIGNED, { ...unassigned });
            }
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
            const previous = await this.prisma.relayInstance.findUnique({ where: { instanceId } });
            await this.prisma.relayInstance.delete({ where: { instanceId } });
            if (previous) {
                const unassigned: RelayInstanceAssignmentEvent = { relay_id: previous.relayId, instance_id: instanceId, action: 'unassigned', time: Date.now() };
                this.emitter.emit(Events.RELAY_INSTANCE_UNASSIGNED, unassigned);
                this.ws.emit(WsFrames.RELAY_INSTANCE_UNASSIGNED, { ...unassigned });
            }
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

    /**
     * Cleanup state of a relay, as reported by the API.
     *
     * Read from {@link RelayLifecycle}, the single owner of the grace deadlines, disconnect
     * timestamps and idle timers: no callback to register, and the serializer stays independent of
     * the creator (which *acts* on that state, while this only *reports* it).
     */
    getLifecycleInfo(relay: RelayWithMethods, liveInstances: number | null = null): ApiRelayLifecycle | null {
        return this.relayLifecycle.serialize(
            relay,
            this.runners.managed().some((r) => r.name === relay.provider),
            this.isRelayConnected(relay.id),
            liveInstances,
        );
    }

    /**
     * Cleanup state of a relay, or null when no auto-manager is registered.
     *
     * @param liveInstances Instances the relay currently reports, or null when it is offline —
     *                      used to hide grace/idle information for relays that are not empty.
     */
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

    /**
     * Stop and destroy the relay's process/container through its provider runner.
     * The database row is left untouched — callers decide whether to delete it.
     *
     * Routed through {@link RunnerFactory} so every provider (Docker today, Kubernetes
     * or Proxmox later) cleans up its own resources; callers never talk to Docker directly.
     */
    async removeRunner(id: number, kill: boolean = true): Promise<void> {
        const relay = await this.findById(id);
        if (!relay) throw new Error(`Relay (${id}) not found`);

        const runner = this.runners.get(relay.provider);
        if (relay.providerId) await runner.remove(relay.providerId, kill);

        this.logger.log(`Relay #${id} provider resources ${kill ? 'killed' : 'stopped and removed'}`);
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

            // relay_instances rows deleted via Cascade — announce it so the instances get re-linked
            for (const { instanceId } of affected) {
                const unassigned: RelayInstanceAssignmentEvent = { relay_id: id, instance_id: instanceId, action: 'unassigned', time: Date.now() };
                this.emitter.emit(Events.RELAY_INSTANCE_UNASSIGNED, unassigned);
                this.ws.emit(WsFrames.RELAY_INSTANCE_UNASSIGNED, { ...unassigned });
            }

            const removed: RelayRemovedEvent = { relay_id: row.id, time: Date.now() };
            this.emitter.emit(Events.RELAY_REMOVED, removed);
            this.ws.emit(WsFrames.RELAY_REMOVED, { relay_id: removed.relay_id, time: removed.time });
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

        // If more pairs than allowed, unlink the most recent ones (emits `relay.instance.unassigned`)
        if (pairs.length > maxLink) {
            const excess = pairs.slice(maxLink);
            for (const pair of excess) {
                await this.prisma.relayInstance.delete({ where: { instanceId: pair.instanceId } });
                const unassigned: RelayInstanceAssignmentEvent = { relay_id: relayId, instance_id: pair.instanceId, action: 'unassigned', time: Date.now() };
                this.emitter.emit(Events.RELAY_INSTANCE_UNASSIGNED, unassigned);
                this.ws.emit(WsFrames.RELAY_INSTANCE_UNASSIGNED, { ...unassigned });
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

        const ready: RelayStatusChangeEvent = { relay_id: relayId, status: 'ready', time: Date.now() };
        this.emitter.emit(Events.RELAY_STATUS, ready);
        this.ws.emit(WsFrames.RELAY_STATUS, { ...ready });

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
        const entry: RelayLogFrame = {
            relay_id: relayId,
            time: dto.a,
            level: dto.l,
            message: dto.m,
            tag: dto.t ?? null,
        };
        this.emitter.emit(Events.RELAY_LOGS, entry);
        this.ws.emit(WsFrames.RELAY_LOGS, { time: entry.time, level: entry.level, message: entry.message, tag: entry.tag });
    }

    handleRelaySpecs(relayId: number, raw: unknown) {
        const dto = plainToInstance(RelaySpecsMessageDto, raw ?? {});
        const errors = validateSync(dto, { whitelist: true });
        if (errors.length > 0) {
            this.logger.warn(`Relay #${relayId} sent invalid specs payload`);
            return;
        }
        const specs: RelaySpecsUpdateEvent = {
            relay_id: relayId, time: Date.now(), details: {
                processor: { used: dto.c?.u ?? 0, cores: dto.c?.c ?? 1 },
                memory: { used: dto.m?.u ?? 0, total: dto.m?.t ?? 1 },
                upload: { used: dto.u?.u ?? 0, bandwidth: dto.u?.b ?? 0, packets: dto.u?.p ?? 0 },
                download: { used: dto.d?.u ?? 0, bandwidth: dto.d?.b ?? 0, packets: dto.d?.p ?? 0 },
                mtu: dto.mtu ?? 1452,
            }
        };
        this.emitter.emit(Events.RELAY_SPECS, specs);
        this.ws.emit(WsFrames.RELAY_SPECS, { ...specs });
    }

    handleClientConnected(relayId: number, data: unknown) {
        const dto = plainToInstance(RelayClientEventDto, data ?? {});
        const errors = validateSync(dto);
        if (errors.length > 0) {
            this.logger.warn(`Relay #${relayId} sent invalid client_connected payload`);
            return;
        }
        const event: RelayClientFrame = {
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
        this.emitter.emit(Events.RELAY_CLIENT_CONNECTED, event);
        // The frame drops the connection address and the platform fingerprint.
        this.ws.emit(WsFrames.RELAY_CLIENT_CONNECTED, {
            relay_id: event.relay_id,
            id: event.client.id,
            engine: event.client.engine,
            user: event.client.user,
            connected_at: event.client.connected_at,
            time: event.time,
        });
    }

    handleClientAuthentified(relayId: number, data: unknown) {
        const dto = plainToInstance(RelayClientAuthentifiedDto, data ?? {});
        const errors = validateSync(dto);
        if (errors.length > 0) {
            this.logger.warn(`Relay #${relayId} sent invalid client_authentified payload`);
            return;
        }
        const event: RelayClientAuthentifiedFrame = {
            relay_id: relayId,
            time: Date.now(),
            client_id: dto.id,
            user: dto.user,
        };
        this.emitter.emit(Events.RELAY_CLIENT_AUTHENTIFIED, event);
        this.ws.emit(WsFrames.RELAY_CLIENT_AUTHENTIFIED, { ...event });
    }

    handleClientDisconnected(relayId: number, data: unknown) {
        const dto = plainToInstance(RelayClientDisconnectedDto, data ?? {});
        const errors = validateSync(dto);
        if (errors.length > 0) {
            this.logger.warn(`Relay #${relayId} sent invalid client_disconnected payload`);
            return;
        }
        const event: RelayClientDisconnectedFrame = {
            relay_id: relayId,
            time: Date.now(),
            id: dto.id,
            reason: dto.reason,
            type: dto.type,
        };
        this.emitter.emit(Events.RELAY_CLIENT_DISCONNECTED, event);
        // The frame drops the free-text reason, which is relay-side diagnostic noise.
        this.ws.emit(WsFrames.RELAY_CLIENT_DISCONNECTED, {
            relay_id: event.relay_id,
            id: event.id,
            type: event.type,
            time: event.time,
        });
    }

    handlePlayerJoin(relayId: number, data: unknown) {
        const dto = plainToInstance(RelayPlayerJoinDto, data ?? {});
        const errors = validateSync(dto);
        if (errors.length > 0) {
            this.logger.warn(`Relay #${relayId} sent invalid player_join payload`);
            return;
        }
        const event: RelayPlayerJoinFrame = {
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
        this.emitter.emit(Events.RELAY_PLAYER_JOIN, event);
        // The frame flattens `player` and drops the flags bitmask (UI-only flag).
        this.ws.emit(WsFrames.RELAY_PLAYER_JOIN, {
            relay_id: event.relay_id,
            client_id: event.player.client_id,
            player_id: event.player.player_id,
            display: event.player.display,
            internal_id: event.player.internal_id,
            joined_at: event.player.joined_at,
            time: event.time,
        });
    }

    handlePlayerLeave(relayId: number, data: unknown) {
        const dto = plainToInstance(RelayPlayerLeaveDto, data ?? {});
        const errors = validateSync(dto);
        if (errors.length > 0) {
            this.logger.warn(`Relay #${relayId} sent invalid player_leave payload`);
            return;
        }
        const event: RelayPlayerLeaveFrame = {
            relay_id: relayId,
            time: Date.now(),
            player: {
                player_id: dto.player_id,
                internal_id: dto.internal_id,
                type: dto.type,
                reason: dto.reason,
            },
        };
        this.emitter.emit(Events.RELAY_PLAYER_LEAVE, event);
        this.ws.emit(WsFrames.RELAY_PLAYER_LEAVE, {
            relay_id: event.relay_id,
            player_id: event.player.player_id,
            internal_id: event.player.internal_id,
            type: event.player.type,
            time: event.time,
        });
    }

    handleInstanceSettingsChanged(relayId: number, data: unknown) {
        const raw = data as Record<string, unknown> | null | undefined;
        if (!raw || typeof raw.i !== 'number' || typeof raw.t !== 'number' || typeof raw.th !== 'number') {
            this.logger.warn(`Relay #${relayId} sent invalid instance_settings_changed payload: ${JSON.stringify(data)}`);
            return;
        }
        const event: RelayInstanceSettingsFrame = {
            relay_id: relayId,
            time: Date.now(),
            internal_id: raw.i,
            tps: raw.t,
            threshold: raw.th,
        };
        this.emitter.emit(Events.RELAY_INSTANCE_SETTINGS, event);
        this.ws.emit(WsFrames.RELAY_INSTANCE_SETTINGS, { ...event });
    }

    handleRelayConnected(relayId: number) {
        this.logger.log(`Relay #${relayId} socket authenticated`);
        this.emitter.emit(Events.RELAY_CONNECTED, { relay_id: relayId, time: Date.now() });
    }

    handleRelayDisconnected(relayId: number) {
        this.logger.log(`Relay #${relayId} socket disconnected`);
        this.emitter.emit(Events.RELAY_DISCONNECTED, { relay_id: relayId, time: Date.now() });
    }
}
