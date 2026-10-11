/**
 * Instance auto-cleanup: decides when an instance nobody joined is deleted.
 *
 * Runs off the event bus (`@OnEvent`) plus a single deadline timer, never a fixed interval — see
 * {@link InstanceReaper.scan}. The state it acts on (grace deadlines, idle timers) belongs to
 * {@link InstanceLifecycle}, so anything that merely *reports* the lifecycle can read it
 * without a callback and without importing the reaper.
 */
import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { WsGateway } from '../../ws/ws.gateway';
import { RelayService } from '../relay.service';
import { InstancesService } from '../../instances/instances.service';
import { AppConfigService } from '../../config/config.service';
import { Events } from '../../events/domain-events';
import { EmitterService } from '../../events/emitter.service';
import {
  DEFAULT_IDLE_TTL_MS,
  InstanceLifecycle,
  MIN_SCAN_DELAY_MS,
} from '../../instances/lifecycle/lifecycle.registry';
import type {
  InstanceCreatedEvent,
  InstanceRemovedEvent,
  RelayInstanceAssignmentEvent,
} from '../../events/domain-events';

/**
 * Deletes non-persistent instances that have had nobody inside for `instance.idleTimeout`
 * (config, default 15 min), unless they carry a moderation-namespace `persistent` tag
 * (e.g. `sys:persistent`).
 *
 * Player counts come from the relays' live instance list. Instances whose relay is
 * unknown/disconnected are skipped — never reaped — so a relay outage can never
 * mass-delete instances.
 */
@Injectable()
export class InstanceReaper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InstanceReaper.name);

  private timer: NodeJS.Timeout | null = null;

  /** `${relayId}:${instanceId}` orphan drops already reported (avoids repeating the warning). */
  private readonly orphansLogged = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly relays: RelayService,
    private readonly emitter: EmitterService,
    public readonly lifecycle: InstanceLifecycle,
    @Inject(forwardRef(() => WsGateway))
    private readonly ws: WsGateway,
    @Inject(forwardRef(() => InstancesService))
    private readonly instances: InstancesService,
  ) {}

  async onModuleInit() {
    const ttl = await this.config
      .get<number>('instance.idleTimeout')
      .catch(() => DEFAULT_IDLE_TTL_MS);
    this.lifecycle.setIdleTimeout(ttl);

    // Startup only: grace everything (the idle timers are in memory, so a restart must not look
    // like "empty since forever"), then scan once. Every later scan is triggered by an event or
    // by the deadline timer armed by the previous one — there is no periodic polling.
    await this.graceAllInstances();
    await this.scan();

    this.logger.log(
      ttl > 0
        ? `Instance reaper started (idle TTL: ${ttl / 60_000} min)`
        : 'Instance reaper started (disabled — instance.idleTimeout = 0)',
    );
  }

  onModuleDestroy() {
    if (this.timer) clearTimeout(this.timer);
  }

  // ── Event-driven scans ───────────────────────────────────────────────────────

  /** A new instance is not empty yet: give it time to be shared, downloaded and joined. */
  @OnEvent(Events.INSTANCE_CREATED)
  onInstanceCreated(event: InstanceCreatedEvent) {
    this.lifecycle.grantGrace(event.instance_id, 'created');
    void this.scan();
  }

  /** An instance moved to another relay: the new one is not hosting it yet, so "0 players" lies. */
  @OnEvent(Events.RELAY_INSTANCE_ASSIGNED)
  onInstanceAssigned(event: RelayInstanceAssignmentEvent) {
    this.lifecycle.grantGrace(event.instance_id, 'assigned');
    void this.scan();
  }

  /** The instance lost its relay (or is gone): stop tracking it. */
  @OnEvent(Events.RELAY_INSTANCE_UNASSIGNED)
  onInstanceUnassigned(event: RelayInstanceAssignmentEvent) {
    this.lifecycle.unlink(event.instance_id);
  }

  /** Forget everything about an instance that no longer exists. */
  @OnEvent(Events.INSTANCE_REMOVED)
  onInstanceRemoved(event: InstanceRemovedEvent) {
    this.lifecycle.forget(event.instance_id);
  }

  /**
   * The player count of an instance can only change through these events, so they are what makes
   * the idle timer meaningful: without them nothing would notice that a relay emptied.
   */
  @OnEvent(Events.RELAY_CONNECTED)
  @OnEvent(Events.RELAY_PLAYER_JOIN)
  @OnEvent(Events.RELAY_PLAYER_LEAVE)
  onInstancePopulationMaybeChanged() {
    void this.scan();
  }

  /**
   * Run a scan, then arm the timer for the next deadline.
   *
   * The reaper is inherently deadline-based (an instance must be empty for `idleTimeout`), so one
   * timer is armed for the earliest grace expiry / removal deadline instead of polling on a fixed
   * interval — a scan that finds nothing to do costs nothing until then.
   */
  private async scan(): Promise<void> {
    try {
      await this.reap();
    } catch (e: any) {
      this.logger.warn(`reap error: ${e?.message ?? e}`);
    } finally {
      this.armNextScan();
    }
  }

  /** (Re)arm the single timer to the next moment something has to be re-evaluated. */
  private armNextScan(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const next = this.lifecycle.nextDeadline();
    if (next === null) return;

    this.timer = setTimeout(
      () => {
        this.timer = null;
        void this.scan();
      },
      Math.max(next - Date.now(), MIN_SCAN_DELAY_MS),
    );
  }

  /**
   * Grant a startup grace to every existing instance, mirroring `RelayCreator.graceAllRelays()`.
   *
   * Strictly speaking this is not needed to survive a restart: the idle timers are in memory too,
   * so nothing can reach `instance.idleTimeout` before it has been re-observed empty. It keeps the
   * reported state honest — the UI shows a "grace" on both sides right after a restart.
   */
  private async graceAllInstances(): Promise<void> {
    if (this.lifecycle.getIdleTimeout() <= 0) return; // cleanup disabled — nothing to protect
    const instances = await this.prisma.instances
      .findMany({ select: { id: true } })
      .catch(() => []);
    this.lifecycle.graceAll(instances.map((i) => i.id));
    if (instances.length > 0)
      this.logger.log(
        `Granted a ${InstanceLifecycle.graceSeconds('startup')}s startup grace to ${instances.length} instance(s)`,
      );
  }

  private static playerCount(p: unknown): number {
    if (Array.isArray(p)) return p.length;
    const n = Number(p ?? 0);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * Ask a relay to stop hosting an instance the node knows nothing about.
   *
   * A relay only drops an instance when it is told to (`drop_instance`) or when it syncs on
   * connect. If that frame is missed — or an instance row is deleted without notifying the relay —
   * the relay keeps the world alive and keeps counting it, while the node has nothing left to
   * reconcile against: the UI then shows a relay full of instances that no longer exist.
   */
  private dropOrphan(relayId: number, instanceId: number): void {
    const key = `${relayId}:${instanceId}`;
    if (!this.orphansLogged.has(key)) {
      this.orphansLogged.add(key);
      this.logger.warn(
        `Relay #${relayId} hosts unknown instance #${instanceId} — asking it to drop it`,
      );
    }
    this.ws.pushToRelay(relayId, 'drop_instance', {
      instance_id: instanceId,
      reason: 'orphan',
      message: 'Unknown to the node',
    });
  }

  async reap(): Promise<void> {
    const idleTtlMs = await this.config
      .get<number>('instance.idleTimeout')
      .catch(() => DEFAULT_IDLE_TTL_MS);
    this.lifecycle.setIdleTimeout(idleTtlMs);

    const instances = await this.prisma.instances.findMany({
      include: { link: true },
    });
    const knownIds = new Set(instances.map((i) => i.id));

    // Ask every relay for its live instance list once: it gives the player counts the idle timer
    // needs, and it is the only way to notice a relay still hosting an instance the node has no
    // record of anymore.
    const relayIds = new Set<number>();
    for (const i of instances) if (i.link) relayIds.add(i.link.relayId);
    for (const r of await this.prisma.relays.findMany({ select: { id: true } }))
      relayIds.add(r.id);

    const livePlayersByRelay = new Map<number, Map<number, number>>();
    const seenOrphans = new Set<string>();
    for (const relayId of relayIds) {
      if (!this.relays.isRelayConnected(relayId)) continue;
      const res = await this.ws
        .requestInstances(relayId, 1000, 0)
        .catch(() => null);
      if (!res) continue;
      const players = new Map<number, number>();
      for (const ri of res.instances) {
        const nodeId = Number(ri.n);
        players.set(nodeId, InstanceReaper.playerCount(ri.p));
        if (!knownIds.has(nodeId)) {
          seenOrphans.add(`${relayId}:${nodeId}`);
          this.dropOrphan(relayId, nodeId);
        }
      }
      livePlayersByRelay.set(relayId, players);
    }

    // Forget the orphans that are gone, so a future regression is reported again.
    for (const key of [...this.orphansLogged])
      if (!seenOrphans.has(key)) this.orphansLogged.delete(key);

    if (!idleTtlMs || idleTtlMs <= 0) return; // auto-cleanup disabled — idle timers are meaningless

    const now = Date.now();
    const seen = new Set<number>();

    for (const inst of instances) {
      seen.add(inst.id);

      if (this.lifecycle.isPersistent(inst.tags ?? [])) {
        this.lifecycle.clearIdleTimer(inst.id);
        continue;
      }

      // Freshly created — wait for the grace period before starting the idle timer.
      if (this.lifecycle.inGrace(inst.id)) {
        this.lifecycle.clearIdleTimer(inst.id);
        continue;
      }

      // Only reap when the player count can be positively determined.
      const live = inst.link
        ? livePlayersByRelay.get(inst.link.relayId)
        : undefined;
      if (live === undefined) {
        this.lifecycle.clearIdleTimer(inst.id);
        continue;
      }

      if ((live.get(inst.id) ?? 0) > 0) {
        this.lifecycle.clearIdleTimer(inst.id);
        continue;
      }

      // The idle timer starts here: from now on the instance counts as empty. `started` tells
      // us this call is the one that started it, so only then is the newly scheduled removal
      // worth announcing.
      const started = this.lifecycle.startIdleTimer(inst.id, now);
      const since = this.lifecycle.emptySince(inst.id)!;

      if (started)
        // Announced on the bus: whoever serializes instances turns it into a client signal,
        // so the admin badge flips grace → removal without waiting for the next refetch.
        this.emitter.emit(Events.INSTANCE_LIFECYCLE, {
          instance_id: inst.id,
          relay_id: inst.link?.relayId ?? null,
          lifecycle: 'removal',
          time: now,
        });

      if (now - since >= idleTtlMs) {
        const idleMin = Math.round((now - since) / 60_000);
        this.logger.log(
          `Reaping idle instance #${inst.id} ("${inst.name}") — empty for ${idleMin} min`,
        );

        // `delete()` notifies the relay (reason: idle_timeout) — mirrors the `new_instance` push.
        try {
          await this.instances.delete(inst.id, {
            reason: 'idle_timeout',
            message: `No player for ${idleMin} min`,
          });
        } catch (err: any) {
          this.logger.warn(
            `Failed to delete idle instance #${inst.id}: ${err?.message ?? err}`,
          );
        } finally {
          this.lifecycle.clearIdleTimer(inst.id);
        }
      }
    }

    // Drop the tracking of instances that no longer exist.
    for (const inst of instances) seen.add(inst.id);
    this.lifecycle.forgetMissing(seen);
  }
}
