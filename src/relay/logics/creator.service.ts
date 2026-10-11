import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { AppConfigService } from '../../config/config.service';
import { EmitterService } from '../../events/emitter.service';
import { Events } from '../../events/domain-events';
import { OnWebsocketEventRegister } from '../../events/websocket-event.decorator';
import { WsFrames } from '../../events/websocket-frames';
import { WsService } from '../../ws/ws.service';
import type {
  RelayConnectionEvent,
  RelayCreatedEvent,
  RelayInstanceAssignmentEvent,
  RelayLifecycleChangeEvent,
  RelayRemovedEvent,
  RelayStatusChangeEvent,
} from '../../events/domain-events';
import {
  RelayLifecycle,
  DEFAULT_IDLE_TIMEOUT_MS,
  DISCONNECT_GRACE_S,
  MIN_CHECK_DELAY_MS,
  STARTUP_GRACE_S,
} from '../lifecycle/lifecycle.registry';
import { RelayService } from '../relay.service';
import type {
  RelayWithMethods,
  RelayWithMethodsAndToken,
} from '../relay.model';
import type { RelayModel } from '../../generated/prisma/models/Relay';
import { RunnerFactory } from '../runners/runner.factory';
import type {
  IRelayRunner,
  RelayRunnerEvent,
  RelayRunnerInstance,
} from '../runners/runner.interface';
import type { Socket } from 'socket.io';

/**
 * Relay lifecycle: creates relays on demand and reaps the ones that serve nothing.
 *
 * Creation is deliberate — {@link InstanceDistributor} asks for a relay only when an instance has
 * nowhere to run — and cleanup is deadline-based: grace on boot/start/connect, a disconnect grace,
 * and an idle TTL for connected-but-empty relays. Both are armed as timers, not polled.
 *
 * Everything provider-specific goes through an {@link IRelayRunner} resolved by
 * {@link RunnerFactory}: this service never talks to Docker (or any other backend) directly, and it
 * only reconciles providers whose runner reports `manages === true` — relays managed outside the
 * node (e.g. `external`) are left untouched.
 *
 * Behaviour (when relay.auto_manage = true, default):
 *  - At boot: grace every managed relay, adopt the running processes, then run one health check
 *  - On events (`relay.connected` / `relay.disconnected` / assignments / instances) and on the
 *    deadline the last check armed: run the same health check
 *    - Remove DB records for relays whose process has disappeared
 *    - Remove dead relays (not connected + past grace period) through their provider
 *    - Stop and remove connected relays that have had no linked instance for
 *      `relay.idle_timeout`, unless they are pinned persistent (`sys:persistent`)
 *  - Provider lifecycle events: update status on start / die / destroy
 *
 * The check used to run every 5 s; it is now driven by events, with one timer armed for the next
 * deadline (grace expiry, disconnect grace, idle TTL) — same logic, no polling.
 *
 * Creating relays is deliberately *not* done here: {@link InstanceDistributor} calls
 * {@link RelayCreator.ensureRelayExists} on demand as soon as an instance needs a slot.
 * Pre-creating one periodically would fight the idle cleanup (spawn → sit empty → reap → spawn
 * again).
 */
@Injectable()
export class RelayCreator implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RelayCreator.name);

  private checkTimer: NodeJS.Timeout | null = null;

  /** Unsubscribe handles returned by the runners' event subscriptions. */
  private readonly eventSubscriptions: Array<() => void> = [];

  /** Lock — prevents two simultaneous relay creations (exposed for InstanceDistributor). */
  private creating = false;

  /** Relay IDs currently being created (between create() and the provider's start event). */
  private readonly pendingRelayIds = new Set<number>();

  /** Dedup provider events (providerId-action-relayId). */
  private readonly processedEvents = new Set<string>();

  /** True once auto-management is confirmed enabled (`relay.auto_manage`). */
  private autoManage = false;

  /** Last `relay.idle_timeout` (ms) read by the reaper — cached for the lifecycle API. */
  private idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly emitter: EmitterService,
    private readonly relay: RelayService,
    private readonly runners: RunnerFactory,
    private readonly ws: WsService,
    public readonly lifecycle: RelayLifecycle,
  ) {}

  // ── Client-facing frames ─────────────────────────────────────────────────────
  // The relay creator owns the relay *health* frames (lifecycle, runner status, creation); the
  // relay module owns the rest. Each change publishes the internal event and, when an admin UI
  // must know, the client frame — deliberately, one call after the other.

  @OnWebsocketEventRegister(WsFrames.RELAY_LIFECYCLE)
  @OnWebsocketEventRegister(WsFrames.RELAY_STATUS)
  @OnWebsocketEventRegister(WsFrames.RELAY_CREATED)
  @OnWebsocketEventRegister(WsFrames.RELAY_REMOVED)
  private registerRelayFrame(socket: Socket): Promise<boolean> {
    return Promise.resolve(!!socket.data?.user?.isAdmin?.());
  }

  /**
   * Protect a relay for `seconds` (default {@link STARTUP_GRACE_S}).
   *
   * @param notify Emit a lifecycle event so admin clients refresh. Bulk callers (boot) pass
   *               false — nothing is connected yet and it would spam one event per relay.
   */
  private grantGrace(
    relayId: number,
    seconds: number = STARTUP_GRACE_S,
    notify = true,
  ): void {
    this.lifecycle.grantGrace(relayId, seconds);
    if (notify) this.emitLifecycle(relayId);
  }

  /** True while the relay is inside a grace period. */
  private inGrace(relayId: number): boolean {
    return this.lifecycle.inGrace(relayId);
  }

  /**
   * Tell admin clients that a relay's cleanup state changed (grace granted, idle timer started
   * or cleared, …). The payload is only a signal: clients re-fetch the relay, which keeps the
   * serialized `lifecycle` (persistent / managed / grace / remove_at) the single source of truth.
   */
  private emitLifecycle(relayId: number): void {
    const event: RelayLifecycleChangeEvent = {
      relay_id: relayId,
      time: Date.now(),
    };
    this.emitter.emit(Events.RELAY_LIFECYCLE, event);
    this.ws.emit(WsFrames.RELAY_LIFECYCLE, { ...event });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────────

  async onModuleInit() {
    // Expose the cleanup state to the API (`Relay.serialize()` → `lifecycle`).

    const enabled =
      (await this.config.getOptional<boolean>('relay.auto_manage')) ?? true;
    if (!enabled) {
      this.logger.log('Auto-management disabled (relay.auto_manage = false)');
      return;
    }
    this.lifecycle.setAutoManage(true);

    // Subscribe to the lifecycle events of every managed provider
    for (const runner of this.runners.managed())
      try {
        const unsubscribe = await runner.subscribe(
          (event) => void this.onRunnerEvent(event),
        );
        this.eventSubscriptions.push(unsubscribe);
        this.logger.log(
          `Subscribed to "${runner.name}" relay lifecycle events`,
        );
      } catch (err: any) {
        this.logger.warn(
          `Could not subscribe to "${runner.name}" events: ${err?.message ?? err}`,
        );
      }

    // Relay connection lifecycle: track disconnect times, and re-grant a grace period on every
    // (re)connection so a relay is never reaped right after coming back.
    // (handled by the `@OnEvent` subscribers below)

    // Server start: grace every known relay before anything else can be reaped.
    await this.graceAllRelays();

    // Sync existing relay processes (adopts running ones as freshly started)
    await this.syncRunnerInstances();

    // One check at boot — the previous run's timers are gone, and no event replays them.
    await this.check();
    this.logger.log('Relay creator started');
  }

  onModuleDestroy() {
    if (this.checkTimer) clearTimeout(this.checkTimer);
    for (const unsubscribe of this.eventSubscriptions)
      try {
        unsubscribe();
      } catch {
        /* ignore */
      }
    this.eventSubscriptions.length = 0;
  }

  // ── Event-driven health checks ───────────────────────────────────────────────

  /** A relay (re)connected: its disconnect timer is void, and it gets a fresh grace period. */
  @OnEvent(Events.RELAY_CONNECTED)
  onRelayConnected(event: RelayConnectionEvent) {
    this.lifecycle.markConnected(event.relay_id);
    this.grantGrace(event.relay_id);
    // It may have instances to host again (or none at all): re-evaluate.
    void this.check();
  }

  /** A relay dropped: start the countdown that will declare it dead if it never comes back. */
  @OnEvent(Events.RELAY_DISCONNECTED)
  onRelayDisconnected(event: RelayConnectionEvent) {
    this.lifecycle.markDisconnected(event.relay_id);
    void this.check();
  }

  /** A relay row disappeared: forget everything about it. */
  @OnEvent(Events.RELAY_REMOVED)
  onRelayRemoved(event: RelayRemovedEvent) {
    this.lifecycle.forget(event.relay_id);
  }

  /**
   * The instance assignment of a relay changed (or an instance came/went): its emptiness may have
   * flipped, which is what the idle timer measures.
   */
  @OnEvent(Events.RELAY_INSTANCE_ASSIGNED)
  @OnEvent(Events.RELAY_INSTANCE_UNASSIGNED)
  @OnEvent(Events.INSTANCE_CREATED)
  @OnEvent(Events.INSTANCE_REMOVED)
  onAssignmentsChanged() {
    void this.check();
  }

  /** Run the health check, then arm the timer for the next deadline. */
  private async check(): Promise<void> {
    try {
      await this.checkHosts();
    } finally {
      this.armNextCheck();
    }
  }

  /**
   * (Re)arm the single timer to the next moment a relay needs attention.
   *
   * Three deadlines can be pending: a grace period ending, a disconnect grace period ending, and
   * an idle TTL being reached. Whichever comes first decides when the next check runs; nothing is
   * armed when there is nothing to wait for.
   */
  private armNextCheck(): void {
    if (this.checkTimer) {
      clearTimeout(this.checkTimer);
      this.checkTimer = null;
    }
    const next = this.lifecycle.nextDeadline();
    if (next === null) return;

    this.checkTimer = setTimeout(
      () => {
        this.checkTimer = null;
        void this.check();
      },
      Math.max(next - Date.now(), MIN_CHECK_DELAY_MS),
    );
  }

  // ── Provider lifecycle events ─────────────────────────────────────────────────

  /** Handle a start / die / destroy event reported by a provider runner. */
  private async onRunnerEvent(event: RelayRunnerEvent) {
    if (event.relayId === null) return;

    // Some providers may replay an event — ignore duplicates (providerId-action-relayId).
    const key = `${event.providerId}-${event.action}-${event.relayId}`;
    if (this.processedEvents.has(key)) return;
    this.processedEvents.add(key);
    setTimeout(() => this.processedEvents.delete(key), 5_000);

    switch (event.action) {
      case 'start':
        this.grantGrace(event.relayId);
        this.logger.log(`Relay #${event.relayId}: process started`);
        const up: RelayStatusChangeEvent = {
          relay_id: event.relayId,
          status: 'up',
          time: Date.now(),
        };
        this.emitter.emit(Events.RELAY_STATUS, up);
        this.ws.emit(WsFrames.RELAY_STATUS, { ...up });
        break;

      case 'die':
        this.lifecycle.clearGrace(event.relayId);
        this.logger.log(`Relay #${event.relayId}: process died`);
        const down: RelayStatusChangeEvent = {
          relay_id: event.relayId,
          status: 'down',
          time: Date.now(),
        };
        this.emitter.emit(Events.RELAY_STATUS, down);
        this.ws.emit(WsFrames.RELAY_STATUS, { ...down });
        // Do NOT remove anything here — the provider is expected to restart transient
        // crashes on its own (e.g. the Docker `unless-stopped` restart policy). Removing
        // the process would fight that policy and leave the relay broken; checkHosts()
        // cleans up relays that are truly dead (no connection after the grace periods).
        break;

      case 'destroy':
        this.lifecycle.forget(event.relayId);
        this.logger.log(`Relay #${event.relayId}: process destroyed`);
        // Safe to delete the DB record here: 'destroy' only fires from intentional
        // removals (checkHosts cleanup or an admin action), never from a transient crash.
        // relay.delete() emits relay_removed internally if the record still exists.
        await this.relay.delete(event.relayId).catch(() => null);
        break;
    }
  }

  /**
   * Grant a grace period to every managed relay when the node boots.
   *
   * Without it, a relay whose process is not up yet, or that has not reconnected yet, would be
   * dropped on the very first tick — either as "no process found" or as "past grace period"
   * (no disconnect was ever observed for this boot).
   */
  private async graceAllRelays(): Promise<void> {
    const managedProviders = new Set(this.runners.managed().map((r) => r.name));
    const relays = await this.prisma.relays
      .findMany({ select: { id: true, provider: true } })
      .catch(() => []);

    let granted = 0;
    for (const r of relays)
      if (managedProviders.has(r.provider)) {
        this.grantGrace(r.id, STARTUP_GRACE_S, false);
        granted++;
      }

    if (granted)
      this.logger.log(`Grace period granted to ${granted} relay(s) on startup`);
  }

  /** Adopt the relay processes that are already running when the node boots. */
  private async syncRunnerInstances() {
    for (const runner of this.runners.managed()) {
      try {
        for (const instance of await runner.list()) {
          if (instance.relayId === null) continue;
          // `onRunnerEvent()` grants the grace period — a running process is adopted
          // exactly like a fresh start.
          await this.onRunnerEvent({
            providerId: instance.providerId,
            relayId: instance.relayId,
            action: instance.running ? 'start' : 'die',
          });
        }
      } catch (err: any) {
        this.logger.warn(
          `Could not sync "${runner.name}" relay processes: ${err?.message ?? err}`,
        );
      }
    }
  }

  // ── Periodic health check ─────────────────────────────────────────────────────

  private async checkHosts() {
    try {
      // Only relays whose provider lets the node manage its processes. A relay whose
      // provider cannot be reconciled (e.g. `external`) is never touched here.
      const managed = this.runners.managed();
      const managedProviders = new Set(managed.map((r) => r.name));
      const relays = (
        await this.prisma.relays.findMany({
          include: { _count: { select: { links: true } } },
        })
      ).filter((r) => managedProviders.has(r.provider));

      // Collect the process backing each relay, per managed provider.
      const runnerByRelayId = new Map<
        number,
        { runner: IRelayRunner; instance: RelayRunnerInstance }
      >();
      for (const runner of managed) {
        for (const instance of await runner.list().catch(() => [])) {
          if (instance.relayId !== null)
            runnerByRelayId.set(instance.relayId, { runner, instance });
        }
      }

      for (const r of relays) {
        // No process at all → orphan DB record, remove it. Skipped while a creation is in
        // progress or while the relay is in grace (the process may not show up in list()
        // immediately after a boot or a startRelay).
        if (!runnerByRelayId.has(r.id)) {
          if (this.pendingRelayIds.has(r.id)) continue;
          if (this.relay.pendingStartRelayIds.has(r.id)) continue;
          if (this.inGrace(r.id)) continue;
          this.logger.warn(
            `Relay #${r.id}: no process found, removing DB record`,
          );
          await this.relay.delete(r.id).catch(() => null);
          this.lifecycle.forget(r.id);
          continue;
        }

        // Still in grace (node boot / process just started / relay just connected)
        if (this.inGrace(r.id)) continue;

        // Connected → healthy
        if (this.relay.isRelayConnected(r.id)) continue;

        // Not connected: check disconnect grace period
        const discTime = this.lifecycle.disconnectedAt(r.id);
        if (discTime) {
          const discSecs = (Date.now() - discTime.getTime()) / 1000;
          if (discSecs < DISCONNECT_GRACE_S) continue; // Still within grace
        }

        // Past all grace periods and not connected → dead, remove
        await this.dropRelay(r.id, 'past grace period and not connected');
      }

      // Remove orphan processes: a provider still manages a relay process while its DB record
      // is gone (relay deleted via the API while the process was still up). Removal is
      // delegated to the owning provider so each runner cleans up in its own way.
      const relayIds = new Set(relays.map((r) => r.id));
      for (const [relayId, { runner, instance }] of runnerByRelayId) {
        if (relayIds.has(relayId)) continue;
        this.logger.warn(
          `Relay #${relayId}: orphan "${runner.name}" process found (no DB record), removing`,
        );
        await runner
          .remove(instance.providerId, true)
          .catch((err: any) =>
            this.logger.warn(
              `Relay #${relayId}: could not remove the orphan process: ${err?.message ?? err}`,
            ),
          );
      }

      // Stop every relay that has been sitting empty. No exemption beyond `persistent`: an
      // idle managed relay that has no scheduled removal at all would be a bug.
      await this.reapIdleRelays(relays);
    } catch (err: any) {
      this.logger.warn(`checkHosts error: ${err.message}`);
    }
  }

  /**
   * Stop, destroy and forget a relay, going through its provider runner rather than
   * talking to Docker from here (see {@link RelayService.removeRunner}).
   *
   * `relay.delete()` emits `relay_removed`; the provider also reports the process as destroyed,
   * whose handler calls `relay.delete()` again (no-op by then). If the runner cannot resolve
   * `relay.providerId` (stale id), the process is left behind and the orphan pass in
   * `checkHosts()` picks it up on the next tick once the row is gone.
   */
  private async dropRelay(relayId: number, reason: string): Promise<void> {
    this.logger.warn(`Relay #${relayId}: ${reason} — stopping and removing`);
    await this.relay
      .removeRunner(relayId, true)
      .catch((err: any) =>
        this.logger.warn(
          `Relay #${relayId}: the provider could not remove the runner: ${err?.message ?? err}`,
        ),
      );
    await this.relay.delete(relayId).catch(() => null);
    this.lifecycle.forget(relayId);
  }

  /**
   * Stops and removes connected relays that have had no linked instance for
   * `relay.idle_timeout` (0 disables the cleanup).
   *
   * A relay is only exempt when it is pinned as persistent (moderation-namespace
   * `persistent` tag, e.g. `sys:persistent`) — mirrors {@link InstanceReaper}.
   *
   * Relays that are empty because they are not connected yet are left alone — the
   * dead-relay path above owns them.
   */
  private async reapIdleRelays(
    relays: Array<RelayModel & { _count: { links: number } }>,
  ): Promise<void> {
    const idleTtlMs = await this.config
      .get<number>('relay.idle_timeout')
      .catch(() => DEFAULT_IDLE_TIMEOUT_MS);
    this.lifecycle.setIdleTimeout(idleTtlMs);
    if (!idleTtlMs || idleTtlMs <= 0) return; // idle cleanup disabled

    const now = Date.now();
    const seen = new Set<number>();

    for (const r of relays) {
      seen.add(r.id);

      // Not a candidate (disconnected / still hosting / persistent) → reset its idle timer
      // so the TTL always measures an uninterrupted empty period.
      const candidate =
        this.relay.isRelayConnected(r.id) &&
        r._count.links === 0 &&
        !this.lifecycle.isPersistent(r.tags);
      if (!candidate) {
        // No longer a cleanup candidate (busy / disconnected / persistent): drop the timer
        // and tell the UI, which may still be displaying a scheduled removal.
        if (this.lifecycle.clearEmptyTimer(r.id)) this.emitLifecycle(r.id);
        continue;
      }

      // Just booted / just connected — give it a chance to be linked before counting it idle.
      if (this.inGrace(r.id)) continue;

      // The empty timer starts here; `started` tells us this call is the one that started it,
      // so only then is the newly scheduled removal worth announcing.
      const started = this.lifecycle.startEmptyTimer(r.id, now);
      const since = this.lifecycle.emptySinceAt(r.id)!;
      if (started)
        // The idle timer just started → this relay now has a scheduled removal.
        this.emitLifecycle(r.id);
      if (now - since < idleTtlMs) continue;

      const idleMin = Math.round((now - since) / 60_000);
      await this.dropRelay(r.id, `empty for ${idleMin} min`);
    }

    // Drop timers for relays that no longer exist.
    for (const id of [...this.lifecycle.trackedRelayIds()])
      if (!seen.has(id)) this.lifecycle.forget(id);
  }

  /**
   * Public entry point for other services (e.g. InstanceDistributor) that need
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
      this.logger.log(
        'All relays full or none exist — auto-creating new relay...',
      );
      return await this.createRelayContainer();
    } finally {
      this.creating = false;
    }
  }

  private async createRelayContainer(): Promise<RelayWithMethodsAndToken> {
    // Let the providers themselves decide whether they can host a new relay
    // (`priority()` returns -1 when impossible, e.g. external relays or no Docker daemon).
    const runner = await this.runners.best();
    if (!runner)
      throw new Error('No relay provider is available to create a relay');

    const relay = await this.relay.create({ provider: runner.name });
    this.pendingRelayIds.add(relay.id);
    try {
      await this.relay.startRelay(relay.id);
      // Grant the grace period immediately so checkHosts treats this relay as protected even
      // before the provider's 'start' event fires.
      this.grantGrace(relay.id);
      this.logger.log(
        `Auto-created and started relay #${relay.id} (provider: ${runner.name})`,
      );
      const created: RelayCreatedEvent = {
        relay_id: relay.id,
        provider: relay.provider,
        time: Date.now(),
      };
      this.emitter.emit(Events.RELAY_CREATED, created);
      this.ws.emit(WsFrames.RELAY_CREATED, { ...created });
      return relay;
    } catch (err: any) {
      this.logger.error(
        `Failed to start auto-created relay #${relay.id}: ${err.message}`,
      );
      await this.relay.delete(relay.id).catch(() => null);
      throw err;
    } finally {
      this.pendingRelayIds.delete(relay.id);
    }
  }
}
