/**
 * The cleanup state of every relay: grace deadlines, disconnect timestamps, and idle timers.
 *
 * Split out of `RelayCreator` for the same reason as `InstanceLifecycle`: the creator *acts* on this
 * state (creating relays, reaping them, arming deadlines), while the relay model only *reports* it
 * through {@link RelayLifecycle.serialize}. Keeping it here means the reader needs no
 * callback and no import of the creator.
 *
 * Nothing in here touches a provider or the database — it is the bookkeeping, kept in one place.
 */
import { Injectable } from '@nestjs/common';
import { Tags } from '../../common/tags';
import type { ApiRelayLifecycle } from '../relay.types';

/** Never arm a deadline below this delay, so a clock edge cannot spin the event loop. */
export const MIN_CHECK_DELAY_MS = 1_000;

/** Seconds of grace granted when the node boots, a relay process starts, or a relay connects. */
export const STARTUP_GRACE_S = 60;

/** Seconds after disconnect before we declare a relay dead. */
export const DISCONNECT_GRACE_S = 60;

/** Fallback idle TTL used when `relay.idle_timeout` cannot be read. */
export const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/** Tag (moderation namespace, e.g. `sys:persistent`) marking a relay as persistent (never removed). */
const PERSISTENT_TAG = {
  prefix: Tags.MODERATION,
  value: 'persistent',
} as const;

@Injectable()
export class RelayLifecycle {
  /**
   * Relay ID → epoch ms until which the relay is protected by a grace period.
   *
   * Grace is granted when the node boots, when a relay process starts and when the relay
   * (re)connects: a relay that just came up must never be reaped before it had the chance to
   * report its instances.
   */
  private readonly graceUntil = new Map<number, number>();

  /** Relay ID → time the relay last disconnected. */
  private readonly disconnectTimes = new Map<number, Date>();

  /** Relay ID → time from which the relay has been observed empty (no linked instance). */
  private readonly emptySince = new Map<number, number>();

  /** True once auto-management is confirmed enabled (`relay.auto_manage`). */
  private autoManage = false;

  /** Last `relay.idle_timeout` (ms) read from the config. */
  private idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS;

  // ── Config ──────────────────────────────────────────────────────────────────

  setAutoManage(enabled: boolean): void {
    this.autoManage = enabled;
  }

  isAutoManage(): boolean {
    return this.autoManage;
  }

  setIdleTimeout(ms: number): void {
    this.idleTimeoutMs = ms;
  }

  getIdleTimeout(): number {
    return this.idleTimeoutMs;
  }

  // ── Grace ───────────────────────────────────────────────────────────────────

  /**
   * Protect a relay for `seconds`.
   *
   * The caller decides whether to announce it: bulk callers (boot) pass `false`, because nothing
   * is connected yet and one event per relay would be noise.
   */
  grantGrace(relayId: number, seconds: number = STARTUP_GRACE_S): void {
    this.graceUntil.set(relayId, Date.now() + seconds * 1000);
  }

  /** Drop the grace period (the relay's process is gone). */
  clearGrace(relayId: number): void {
    this.graceUntil.delete(relayId);
  }

  /** True while the relay is inside a grace period. */
  inGrace(relayId: number): boolean {
    const until = this.graceUntil.get(relayId);
    return until !== undefined && Date.now() < until;
  }

  // ── Connection ──────────────────────────────────────────────────────────────

  markDisconnected(relayId: number, at: Date = new Date()): void {
    this.disconnectTimes.set(relayId, at);
  }

  markConnected(relayId: number): void {
    this.disconnectTimes.delete(relayId);
  }

  disconnectedAt(relayId: number): Date | undefined {
    return this.disconnectTimes.get(relayId);
  }

  // ── Idle timer ──────────────────────────────────────────────────────────────

  /**
   * Start (or keep) the empty timer of a relay.
   *
   * @returns true when this call is what started it, i.e. the caller should announce the newly
   *          scheduled removal.
   */
  startEmptyTimer(relayId: number, at: number = Date.now()): boolean {
    if (this.emptySince.has(relayId)) return false;
    this.emptySince.set(relayId, at);
    return true;
  }

  clearEmptyTimer(relayId: number): boolean {
    return this.emptySince.delete(relayId);
  }

  /** From when the relay has been observed empty, or undefined when it is not being tracked. */
  emptySinceAt(relayId: number): number | undefined {
    return this.emptySince.get(relayId);
  }

  // ── Deadlines ───────────────────────────────────────────────────────────────

  /** Epoch ms of the next moment a relay has to be re-evaluated, or null when nothing is pending. */
  nextDeadline(): number | null {
    let next = Infinity;
    for (const until of this.graceUntil.values()) next = Math.min(next, until);
    for (const at of this.disconnectTimes.values())
      next = Math.min(next, at.getTime() + DISCONNECT_GRACE_S * 1000);
    if (this.idleTimeoutMs > 0)
      for (const since of this.emptySince.values())
        next = Math.min(next, since + this.idleTimeoutMs);
    return Number.isFinite(next) ? next : null;
  }

  // ── Reporting ───────────────────────────────────────────────────────────────

  /** True when the relay must never be auto-removed. */
  isPersistent(tags: readonly string[] | null | undefined): boolean {
    return Tags.has(tags, PERSISTENT_TAG.prefix, PERSISTENT_TAG.value);
  }

  /**
   * Cleanup state of a relay, as reported by the API.
   *
   * Synchronous and cheap: it only reads the maps above, so the values are at most one check
   * stale. `null` means "nothing to say" — which is most relays most of the time.
   */
  serialize(
    relay: { id: number; provider: string; tags: string[] },
    managed: boolean,
    isConnected: boolean,
    liveInstances: number | null = null,
  ): ApiRelayLifecycle | null {
    // Nothing is ever removed by this node for an unmanaged provider or when auto-management is off.
    if (!this.autoManage) return null;
    if (!managed) return null;

    // Pinned: never auto-removed, whatever the grace or idle timers say.
    if (this.isPersistent(relay.tags)) return { type: 'persistent' };

    // Busy relay (or one the relay itself reports as busy): nothing to clean up.
    if (liveInstances !== null && liveInstances > 0) return null;

    const now = Date.now();

    // Grace — the node just booted, the process just started or the relay just (re)connected.
    const graceUntil = this.graceUntil.get(relay.id);
    if (graceUntil !== undefined && now < graceUntil)
      return { type: 'grace', key: 'startup', expires: graceUntil };

    // Not connected: either still inside the disconnect grace period, or dead and about to be
    // dropped the moment the grace is over.
    if (!isConnected) {
      const discTime = this.disconnectTimes.get(relay.id);
      const until = discTime
        ? discTime.getTime() + DISCONNECT_GRACE_S * 1000
        : 0;
      return until > now
        ? { type: 'grace', key: 'disconnect', expires: until }
        : { type: 'removal', at: now + MIN_CHECK_DELAY_MS };
    }

    // Connected and empty: the creator removes it once the idle TTL is reached. (`emptySince` is
    // only tracked for relays that are actually candidates: connected, no linked instance and
    // not persistent.)
    const since = this.emptySince.get(relay.id);
    if (since !== undefined && this.idleTimeoutMs > 0)
      return { type: 'removal', at: since + this.idleTimeoutMs };

    return null;
  }

  /** Every relay the registry currently tracks, for the caller's "no longer exists" sweep. */
  trackedRelayIds(): number[] {
    return [
      ...new Set([
        ...this.graceUntil.keys(),
        ...this.disconnectTimes.keys(),
        ...this.emptySince.keys(),
      ]),
    ];
  }

  // ── Housekeeping ─────────────────────────────────────────────────────────────

  /** Forget a relay that is gone (deleted, or its process destroyed). */
  forget(relayId: number): void {
    this.graceUntil.delete(relayId);
    this.disconnectTimes.delete(relayId);
    this.emptySince.delete(relayId);
  }
}
