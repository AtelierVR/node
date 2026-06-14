import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject, forwardRef } from '@nestjs/common';
import Docker from 'dockerode';
import { PrismaService } from '../database/prisma.service';
import { AppConfigService } from '../config/config.service';
import { EventsService } from '../gateway/events.service';
import { RelayService } from './relay.service';
import { RelayGateway } from './relay.gateway';
import type { RelayWithMethodsAndToken } from './relay.model';
import { WsGateway } from '../ws/ws.gateway';

/** Label used to identify relay containers. */
const RELAY_LABEL = 'nox.relay.id';
/** Label used to scope relay containers to a specific Nox instance. */
const GROUP_LABEL = 'nox.relay.group';

/** How often (ms) to check relay health. */
const CHECK_INTERVAL_MS = 5_000;

/** Seconds after container start before we enforce connectivity. */
const STARTUP_GRACE_S = 60;

/** Seconds after disconnect before we declare a relay dead. */
const DISCONNECT_GRACE_S = 60;

interface ContainerEvent {
    id: string;
    action: string;
    relayId: number;
}

/**
 * RelayAutoManager replicates the automatic relay lifecycle management from node.old/.
 *
 * Behaviour (when relay.auto_manage = true, default):
 *  - Every 5 s: check all docker relays
 *    - Remove DB records for relays whose container has disappeared
 *    - Remove dead relays (not connected + past grace period) and their containers
 *    - If all relays are full (or none exist), spin up a new one automatically
 *  - Docker event stream: update status on start / die / destroy
 */
@Injectable()
export class RelayAutoManager implements OnModuleInit, OnModuleDestroy {

    private readonly logger = new Logger(RelayAutoManager.name);

    private docker!: Docker;

    private async group(): Promise<string> {
        return this.config.get<string>('relay.group');
    }

    private checkTimer: NodeJS.Timeout | null = null;
    private eventStream: any = null;

    /** Lock — prevents two simultaneous relay creations (exposed for InstanceDistributorService). */
    private creating = false;

    /** Relay IDs currently being created (between create() and container start event). */
    private readonly pendingRelayIds = new Set<number>();

    /** Relay ID → time the container last started. */
    private readonly containerStartTimes = new Map<number, Date>();

    /** Relay ID → time the relay last disconnected. */
    private readonly disconnectTimes = new Map<number, Date>();

    /** Dedup Docker events (id-action-relayId). */
    private readonly processedEvents = new Set<string>();

    constructor(
        private readonly prisma: PrismaService,
        private readonly config: AppConfigService,
        private readonly events: EventsService,
        private readonly relay: RelayService,
        private readonly gateway: RelayGateway,
        @Inject(forwardRef(() => WsGateway))
        private readonly wsGateway: WsGateway,
    ) { }

    // ── Lifecycle ─────────────────────────────────────────────────────────────────

    async onModuleInit() {
        const enabled = (await this.config.getOptional<boolean>('relay.auto_manage')) ?? true;
        if (!enabled) {
            this.logger.log('Auto-management disabled (relay.auto_manage = false)');
            return;
        }

        // Initialise Docker client (same config key as DockerRunner)
        let opts: any = await this.config.getOptional<string | object>('relay.docker_options');
        if (typeof opts === 'string')
            try { opts = JSON.parse(opts); }
            catch { opts = {}; }
        this.docker = new Docker((opts as Docker.DockerOptions) ?? {});

        // Subscribe to the Docker event stream
        try {
            this.eventStream = await this.docker.getEvents({
                filters: {
                    label: [
                        RELAY_LABEL,
                        `${GROUP_LABEL}=${await this.group()}`
                    ]
                }
            });

            this.eventStream.on('data', (buf: Buffer) => this.onContainerEvent(buf));
            this.eventStream.on('error', (err: Error) => this.logger.warn(`Docker event stream error: ${err.message}`));
            this.logger.log('Subscribed to Docker relay event stream');
        } catch (err: any) {
            this.logger.warn(`Could not subscribe to Docker events: ${err.message}`);
        }

        // Hook into relay disconnect events so we can track disconnect times
        this.relay.onDisconnect((relayId) => void this.disconnectTimes.set(relayId, new Date()));
        this.relay.onConnect((relayId) => void this.disconnectTimes.delete(relayId));

        // Sync existing containers (treat running ones as already started)
        await this.syncExistingContainers();

        // Periodic health check
        this.checkTimer = setInterval(() => this.checkHosts(), CHECK_INTERVAL_MS);
        this.logger.log('Relay auto-manager started');
    }

    onModuleDestroy() {
        if (this.checkTimer)
            clearInterval(this.checkTimer);
        if (this.eventStream)
            try {
                this.eventStream.destroy();
            } catch { /* ignore */ }
    }

    // ── Docker event stream ───────────────────────────────────────────────────────

    private async onContainerEvent(buf: Buffer) {
        try {
            const obj = JSON.parse(buf.toString());
            if (obj.Type !== 'container') return;

            const relayId = parseInt(obj.Actor?.Attributes?.[RELAY_LABEL], 10);
            if (isNaN(relayId)) return;

            const key = `${obj.id}-${obj.Action}-${relayId}`;
            if (this.processedEvents.has(key)) return;
            this.processedEvents.add(key);
            setTimeout(() => this.processedEvents.delete(key), 5_000);

            await this.handleContainerAction({
                id: obj.id || obj.Actor?.ID || '',
                action: obj.Action,
                relayId,
            });
        } catch { /* ignore parse errors */ }
    }

    private async syncExistingContainers() {
        try {
            const containers = await this.docker.listContainers({
                all: true,
                filters: {
                    label: [
                        RELAY_LABEL,
                        `${GROUP_LABEL}=${await this.group()}`
                    ]
                },
            });
            for (const c of containers) {
                const relayId = parseInt(c.Labels[RELAY_LABEL], 10);
                if (isNaN(relayId)) continue;
                // Mark as "just started" so we don't immediately declare them dead
                if (c.State === 'running') this.containerStartTimes.set(relayId, new Date());
                await this.handleContainerAction({
                    id: c.Id,
                    action: c.State === 'running' ? 'start' : 'die',
                    relayId,
                });
            }
        } catch (err: any) {
            this.logger.warn(`Could not sync existing containers: ${err.message}`);
        }
    }

    private async handleContainerAction(event: ContainerEvent) {
        switch (event.action) {
            case 'start':
                this.containerStartTimes.set(event.relayId, new Date());
                this.logger.log(`Container started for relay #${event.relayId}`);
                this.events.emit('relay_status_change', { relay_id: event.relayId, status: 'up', time: Date.now() });
                break;

            case 'die':
                this.containerStartTimes.delete(event.relayId);
                this.logger.log(`Container died for relay #${event.relayId}`);
                this.events.emit('relay_status_change', { relay_id: event.relayId, status: 'down', time: Date.now() });
                // Do NOT remove the container here — the RestartPolicy (unless-stopped) will
                // automatically restart it on transient failures. Force-removing it would fight
                // the restart policy and leave the relay in a broken state. checkHosts() handles
                // cleanup of relays that are truly dead (no connection after grace periods).
                break;

            case 'destroy':
                this.containerStartTimes.delete(event.relayId);
                this.disconnectTimes.delete(event.relayId);
                this.logger.log(`Container destroyed for relay #${event.relayId}`);
                // Safe to delete the DB record here: the die handler no longer calls
                // container.remove(), so destroy only fires from intentional removals
                // (checkHosts cleanup or admin action), never from a transient crash.
                // relay.delete() emits relay_removed internally if the record still exists.
                await this.relay.delete(event.relayId).catch(() => null);
                break;
        }
    }

    // ── Periodic health check ─────────────────────────────────────────────────────

    private async checkHosts() {
        try {
            const relays = await this.prisma.relays.findMany({ where: { provider: 'docker' } });

            const containers = await this.docker.listContainers({
                all: true,
                filters: {
                    label: [
                        RELAY_LABEL,
                        `${GROUP_LABEL}=${await this.group()}`
                    ]
                },
            });
            const containersByRelayId = new Map<number, Docker.ContainerInfo>();
            for (const c of containers) {
                const rid = parseInt(c.Labels[RELAY_LABEL], 10);
                if (!isNaN(rid)) containersByRelayId.set(rid, c);
            }

            for (const r of relays) {
                // No container at all → orphan DB record, remove it.
                // Skip if creation is still in progress, or if we set a start time recently
                // (the container may not appear in listContainers immediately after startRelay).
                if (!containersByRelayId.has(r.id)) {
                    if (this.pendingRelayIds.has(r.id)) continue;
                    if (this.relay.pendingStartRelayIds.has(r.id)) continue;
                    const startTime = this.containerStartTimes.get(r.id);
                    if (startTime && (Date.now() - startTime.getTime()) / 1000 < STARTUP_GRACE_S) continue;
                    this.logger.warn(`Relay #${r.id}: no container found, removing DB record`);
                    await this.relay.delete(r.id).catch(() => null);
                    this.containerStartTimes.delete(r.id);
                    this.disconnectTimes.delete(r.id);
                    continue;
                }

                // Still in startup grace period — don't touch it
                const startTime = this.containerStartTimes.get(r.id);
                if (startTime) {
                    const ageSecs = (Date.now() - startTime.getTime()) / 1000;
                    if (ageSecs < STARTUP_GRACE_S) continue;
                }

                // Connected → healthy
                if (this.relay.isRelayConnected(r.id)) continue;

                // Not connected: check disconnect grace period
                const discTime = this.disconnectTimes.get(r.id);
                if (discTime) {
                    const discSecs = (Date.now() - discTime.getTime()) / 1000;
                    if (discSecs < DISCONNECT_GRACE_S) continue; // Still within grace
                }

                // Past all grace periods and not connected → dead, remove
                this.logger.warn(`Relay #${r.id}: past grace period and not connected — removing`);
                const containerInfo = containersByRelayId.get(r.id)!;
                try {
                    const container = this.docker.getContainer(containerInfo.Id);
                    if (containerInfo.State === 'running') await container.stop({ t: 5 }).catch(() => null);
                    await container.remove({ force: true }).catch(() => null);
                } catch { /* ignore */ }
                // relay.delete() emits relay_removed; container.remove() above will also trigger
                // the destroy handler which calls relay.delete() again (no-op if already deleted).
                await this.relay.delete(r.id).catch(() => null);
                this.containerStartTimes.delete(r.id);
                this.disconnectTimes.delete(r.id);
            }

            // Remove orphan containers: containers labelled with a relay ID that has no DB record.
            // This happens when a relay is deleted via the API (DB deleted, container left running).
            const relayIds = new Set(relays.map(r => r.id));
            for (const [relayId, containerInfo] of containersByRelayId) {
                if (!relayIds.has(relayId)) {
                    this.logger.warn(`Relay #${relayId}: orphan container found (no DB record), removing`);
                    try {
                        const container = this.docker.getContainer(containerInfo.Id);
                        if (containerInfo.State === 'running') await container.stop({ t: 5 }).catch(() => null);
                        await container.remove({ force: true }).catch(() => null);
                    } catch { /* ignore */ }
                }
            }

            // Create a new relay if all are full (or none exist)
            if (await this.isFull()) {
                await this.ensureRelayExists();
            }
        } catch (err: any) {
            this.logger.warn(`checkHosts error: ${err.message}`);
        }
    }

    /**
     * Returns true when a new relay container should be created:
     *  - No docker relays exist, OR
     *  - Every relay that is connected (or in startup grace) is at full capacity.
     */
    private async isFull(): Promise<boolean> {
        const relays = await this.prisma.relays.findMany({ where: { provider: 'docker' } });
        if (relays.length === 0) return true;

        let anyNotFull = false;
        for (const r of relays) {
            const connected = this.relay.isRelayConnected(r.id);
            const startTime = this.containerStartTimes.get(r.id);
            const inStartupGrace = startTime && (Date.now() - startTime.getTime()) / 1000 < STARTUP_GRACE_S;

            if (!connected && !inStartupGrace) continue; // dead / not relevant

            if (inStartupGrace && !connected) {
                // Starting up — assume not full yet
                anyNotFull = true;
                continue;
            }

            // Connected: query live status
            const status = await this.wsGateway.requestStatus(r.id, 2_000).catch(() => null);
            if (!status) {
                // Can't reach it → assume not full
                anyNotFull = true;
                continue;
            }
            if ((status.i ?? 0) < (status.m ?? 1)) {
                anyNotFull = true;
            }
        }

        return !anyNotFull;
    }

    /**
     * Public entry point for other services (e.g. InstanceDistributorService) that need
     * a relay but find none with capacity.  Uses the same `creating` lock as the periodic
     * checker to guarantee only one relay is spawned at a time.
     *
     * @returns the newly created relay (with token), or null if creation was skipped
     *          because another caller is already creating one.
     */
    async ensureRelayExists(): Promise<RelayWithMethodsAndToken | null> {
        if (this.creating) {
            this.logger.debug('Relay creation already in progress, skipping');
            return null;
        }
        this.creating = true;
        try {
            this.logger.log('All relays full or none exist — auto-creating new relay...');
            return await this.createRelayContainer();
        } finally {
            this.creating = false;
        }
    }

    private async createRelayContainer(): Promise<RelayWithMethodsAndToken> {
        const relay = await this.relay.create({ provider: 'docker' });
        this.pendingRelayIds.add(relay.id);
        try {
            await this.relay.startRelay(relay.id);
            // Mark startup time immediately so checkHosts treats this relay as "in startup
            // grace" even before the Docker 'start' event fires.
            this.containerStartTimes.set(relay.id, new Date());
            this.logger.log(`Auto-created and started relay #${relay.id}`);
            this.events.emit('relay_added', { relay_id: relay.id, time: Date.now() });
            return relay;
        } catch (err: any) {
            this.logger.error(`Failed to start auto-created relay #${relay.id}: ${err.message}`);
            await this.relay.delete(relay.id).catch(() => null);
            throw err;
        } finally {
            this.pendingRelayIds.delete(relay.id);
        }
    }
}
