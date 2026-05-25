import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { WellKnownService } from '../fediverse/well-known.service';
import { NoxIdentifier } from '../common/identifier';
import { RelayService } from './relay.service';
import { InstancesService } from '../instances/instances.service';
import { WsGateway } from '../ws/ws.gateway';
import type { RelayInstanceSlot } from './relay.types';

/** Safety-net interval: links any orphaned instances every 15 s. */
const LINK_INTERVAL_MS = 15_000;

@Injectable()
export class InstanceDistributorService implements OnModuleInit, OnModuleDestroy {

    private readonly logger = new Logger(InstanceDistributorService.name);
    private timer: NodeJS.Timeout | null = null;

    constructor(
        private readonly prisma: PrismaService,
        private readonly wellKnown: WellKnownService,
        private readonly relayService: RelayService,
        @Inject(forwardRef(() => WsGateway))
        private readonly wsGateway: WsGateway,
        @Inject(forwardRef(() => InstancesService))
        private readonly instancesService: InstancesService,
    ) { }

    onModuleInit() {
        // Instance created → link immediately
        this.instancesService.onInstanceCreated((id) => void this.link(id));
        // Instance freed (unassigned) → re-link
        this.relayService.onInstanceUnassigned((id) => void this.link(id));
        // Relay connected → link any orphans it could now absorb
        this.relayService.onConnect(() => void this.linkAllUnassigned());
        // Safety-net cron
        this.timer = setInterval(() => void this.linkAllUnassigned(), LINK_INTERVAL_MS);
        // On startup: link any instances that have no relay pair yet
        void this.linkAllUnassigned();
    }

    onModuleDestroy() {
        if (this.timer) clearInterval(this.timer);
    }

    // ── Public API ─────────────────────────────────────────────────────────────

    /**
     * Links a single instance to the first relay with available capacity.
     * Creates a new relay automatically if none has room.
     * Pushes the instance directly to the relay if it is currently connected.
     */
    async link(instanceId: number): Promise<void> {
        const inst = await this.prisma.instances.findUnique({
            where: { id: instanceId },
            include: { link: true },
        });
        if (!inst || inst.link !== null) return;

        let targetId = await this.findRelayWithCapacity();

        if (targetId === null) {
            const relay = await this.relayService.create({ provider: 'docker' });
            await this.relayService.startRelay(relay.id);
            targetId = relay.id;
            this.logger.log(`No relay had capacity — created relay #${targetId} for instance #${instanceId}`);
        }

        await this.relayService.assignInstance(targetId, instanceId);
        this.logger.log(`Linked instance #${instanceId} → relay #${targetId}`);

        if (this.relayService.isRelayConnected(targetId)) {
            await this.pushSlot(targetId, inst);
        }
    }

    /** Links all instances that currently have no relay assignment. */
    async linkAllUnassigned(): Promise<void> {
        const unassigned = await this.prisma.instances.findMany({
            where: { link: null },
            select: { id: true },
            orderBy: { createdAt: 'asc' },
        });
        for (const { id } of unassigned)
            await this.link(id);
    }

    // ── Internals ──────────────────────────────────────────────────────────────

    /** Returns the ID of the first relay where pair count < maxInstances, or null. */
    private async findRelayWithCapacity(): Promise<number | null> {
        const relays = await this.prisma.relays.findMany({
            include: { _count: { select: { links: true } } },
            orderBy: { id: 'asc' },
        });
        for (const relay of relays)
            if (relay._count.links < relay.maxLink)
                return relay.id;
        return null;
    }

    private async pushSlot(relayId: number, inst: { id: number; capacity: number; password: string | null; worldRef: string }): Promise<void> {
        const domain = await this.wellKnown.address();
        const ni = NoxIdentifier.parse(inst.worldRef);
        const worldId = ni.numericId;
        if (!worldId) {
            this.logger.error(`Instance #${inst.id} has invalid worldRef: ${inst.worldRef}`);
            return;
        }
        const rawV = ni.query['v'];
        const version = rawV !== undefined ? (parseInt(rawV, 10) || 65535) : 65535;

        const slot: RelayInstanceSlot = {
            id: inst.id,
            password: inst.password,
            capacity: inst.capacity,
            world: { id: worldId, address: domain, version },
        };

        this.wsGateway.pushToRelay(relayId, 'new_instance', slot);
    }
}

