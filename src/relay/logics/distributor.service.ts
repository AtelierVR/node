/**
 * Instance placement: makes sure every instance has a relay slot.
 *
 * Reacts to the domain events (an instance appeared, an instance lost its relay, a relay became
 * available) and asks {@link RelayCreator} for a new relay only when nothing has room. A single
 * pass at boot covers what the previous run left behind; there is no polling afterwards.
 */
import {
  Injectable,
  Logger,
  OnModuleInit,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { WellKnownService } from '../../fediverse/well-known.service';
import { NoxIdentifier } from '../../common/identifier';
import { RelayService } from '../relay.service';
import { RelayCreator } from './creator.service';
import { WsGateway } from '../../ws/ws.gateway';
import { Events } from '../../events/domain-events';
import type {
  InstanceCreatedEvent,
  RelayConnectionEvent,
  RelayInstanceAssignmentEvent,
} from '../../events/domain-events';
import type { RelayInstanceSlot } from '../relay.types';

@Injectable()
export class InstanceDistributor implements OnModuleInit {
  private readonly logger = new Logger(InstanceDistributor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wellKnown: WellKnownService,
    private readonly relayService: RelayService,
    private readonly creator: RelayCreator,
    @Inject(forwardRef(() => WsGateway))
    private readonly wsGateway: WsGateway,
  ) {}

  /**
   * Startup pass: there is no replayed event history, so whatever was left unlinked by the previous
   * run has to be picked up here. After that, only events drive the linking.
   */
  onModuleInit() {
    void this.linkAllUnassigned();
  }

  /** A new instance is persisted and has no relay yet. */
  @OnEvent(Events.INSTANCE_CREATED, { async: true })
  async onInstanceCreated(event: InstanceCreatedEvent) {
    await this.link(event.instance_id);
  }

  /** An instance lost its relay (relay removed, over-capacity, admin unlink): re-home it. */
  @OnEvent(Events.RELAY_INSTANCE_UNASSIGNED, { async: true })
  async onInstanceUnassigned(event: RelayInstanceAssignmentEvent) {
    await this.link(event.instance_id);
  }

  /** A relay just authenticated: it can absorb orphans, and a fresh one has free capacity. */
  @OnEvent(Events.RELAY_CONNECTED, { async: true })
  @OnEvent(Events.RELAY_CREATED, { async: true })
  async onRelayAvailable(_event: RelayConnectionEvent) {
    await this.linkAllUnassigned();
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
      const relay = await this.creator.ensureRelayExists();
      if (!relay) {
        // Another caller is already creating a relay — the instance is picked up again when
        // that relay is created (`@OnEvent(RELAY_CREATED)`) or connects.
        this.logger.debug(
          `Instance #${instanceId} waiting for in-progress relay creation`,
        );
        return;
      }
      targetId = relay.id;
      this.logger.log(
        `No relay had capacity — created relay #${targetId} for instance #${instanceId}`,
      );
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
    for (const { id } of unassigned) await this.link(id);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /** Returns the ID of the first relay where pair count < maxInstances, or null. */
  private async findRelayWithCapacity(): Promise<number | null> {
    const relays = await this.prisma.relays.findMany({
      include: { _count: { select: { links: true } } },
      orderBy: { id: 'asc' },
    });
    for (const relay of relays)
      if (relay._count.links < relay.maxLink) return relay.id;
    return null;
  }

  private async pushSlot(
    relayId: number,
    inst: {
      id: number;
      capacity: number;
      password: string | null;
      worldRef: string;
    },
  ): Promise<void> {
    const domain = await this.wellKnown.address();
    const ni = NoxIdentifier.parse(inst.worldRef);
    const worldId = ni.numericId;
    if (!worldId) {
      this.logger.error(
        `Instance #${inst.id} has invalid worldRef: ${inst.worldRef}`,
      );
      return;
    }
    const rawV = ni.query['v'];
    const version = rawV !== undefined ? parseInt(rawV, 10) || 65535 : 65535;

    const slot: RelayInstanceSlot = {
      id: inst.id,
      password: inst.password,
      capacity: inst.capacity,
      world: { id: worldId, address: domain, version },
    };

    this.wsGateway.pushToRelay(relayId, 'new_instance', slot);
  }
}
