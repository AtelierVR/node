/**
 * The cleanup state of every instance: grace deadlines and idle timers.
 *
 * Split out of `InstanceReaper` so the state has an owner of its own. The reaper *acts* on it
 * (scanning, reaping, arming deadlines); the instance model only *reports* it through
 * {@link InstanceLifecycle.serialize}, with no callback and no injection cycle between the reaper
 * and whoever serializes instances.
 */
import { Injectable } from '@nestjs/common';
import { Tags } from '../../common/tags';
import type {
  ApiInstanceLifecycle,
  InstanceGraceKind,
} from './lifecycle.types';

/** Never arm a deadline below this delay, so a clock edge cannot spin the event loop. */
export const MIN_SCAN_DELAY_MS = 1_000;

/** Fallback idle TTL used when the config value cannot be read. */
export const DEFAULT_IDLE_TTL_MS = 15 * 60 * 1000;

/**
 * How long each reason shields an instance from the reaper, in seconds.
 *
 * `created` is the long one: a brand new instance is not empty yet — nobody had the time to be told
 * about it, share the link, download the world and join. Reaping it after a minute could delete a
 * perfectly valid instance before its creator ever opened the page. `assigned` and `startup` only
 * need to cover the hand-off to a relay, so they stay short.
 */
const GRACE_SECONDS: Record<InstanceGraceKind, number> = {
  created: 10 * 60,
  assigned: 60,
  startup: 60,
};

/** Tag (moderation namespace, e.g. `sys:persistent`) marking an instance as persistent (never auto-deleted). */
const PERSISTENT_TAG = {
  prefix: Tags.MODERATION,
  value: 'persistent',
} as const;

/**
 * Specificity of a grace reason: a running grace is only replaced by a more specific one.
 *
 * `startup` is granted to every instance at boot, so the more precise `assigned` (the instance was
 * just moved) and `created` (it was just created) must be able to override it — and `created`
 * must survive the assignment that follows it, since creating an instance immediately links it.
 */
const GRACE_RANK: Record<InstanceGraceKind, number> = {
  startup: 0,
  assigned: 1,
  created: 2,
};

@Injectable()
export class InstanceLifecycle {
  /** instanceId → timestamp from which it has been observed empty. */
  private readonly idleSince = new Map<number, number>();

  /** instanceId → epoch ms until which the instance is protected by a grace period. */
  private readonly graceUntil = new Map<number, number>();

  /** instanceId → why the grace period was granted (reported through the lifecycle API). */
  private readonly graceKind = new Map<number, InstanceGraceKind>();

  /** Last `instance.idleTimeout` (ms) read from the config — read by the reaper, cached for the API. */
  private idleTimeoutMs = DEFAULT_IDLE_TTL_MS;

  // ── Config ──────────────────────────────────────────────────────────────────

  /** Cache the configured idle TTL. `0` (or less) disables the whole cleanup. */
  setIdleTimeout(ms: number): void {
    this.idleTimeoutMs = ms;
  }

  getIdleTimeout(): number {
    return this.idleTimeoutMs;
  }

  /** True when the instance must never be auto-deleted. */
  isPersistent(tags: readonly string[] | null | undefined): boolean {
    return Tags.has(tags, PERSISTENT_TAG.prefix, PERSISTENT_TAG.value);
  }

  // ── Grace ───────────────────────────────────────────────────────────────────

  /**
   * Protect an instance, remembering why.
   *
   * A running grace with a more specific reason is *kept* (see {@link GRACE_RANK}) — and so is its
   * deadline. Creating an instance immediately assigns it to a relay, so without this the
   * 60 s `assigned` grace would silently replace the 10 min `created` one a moment later.
   * A less specific reason never shortens a grace either; only a more specific one extends it.
   */
  grantGrace(
    instanceId: number,
    kind: InstanceGraceKind,
    seconds: number = GRACE_SECONDS[kind],
  ): void {
    const previousUntil = this.graceUntil.get(instanceId);
    const previousKind = this.graceKind.get(instanceId);
    const previousIsRunning =
      previousUntil !== undefined && Date.now() < previousUntil;

    if (
      previousIsRunning &&
      previousKind !== undefined &&
      GRACE_RANK[previousKind] >= GRACE_RANK[kind]
    ) {
      // Nothing to change: the running grace is at least as meaningful and at least as long.
      return;
    }

    // A grace that already ran out is replaced: the deadline is measured from now.
    this.graceUntil.set(
      instanceId,
      Math.max(Date.now(), previousUntil ?? 0) + seconds * 1000,
    );
    this.graceKind.set(instanceId, kind);
  }

  /** True while the instance is inside a grace period. */
  inGrace(instanceId: number): boolean {
    const until = this.graceUntil.get(instanceId);
    return until !== undefined && Date.now() < until;
  }

  // ── Idle timer ──────────────────────────────────────────────────────────────

  /**
   * Start (or keep) the idle timer of an instance.
   *
   * @returns true when this call is what started it, i.e. the caller should announce the new
   *          scheduled removal.
   */
  startIdleTimer(instanceId: number, at: number = Date.now()): boolean {
    if (this.idleSince.has(instanceId)) return false;
    this.idleSince.set(instanceId, at);
    return true;
  }

  /** Stop the idle timer: the instance is busy, protected, gone, or cannot be evaluated. */
  clearIdleTimer(instanceId: number): void {
    this.idleSince.delete(instanceId);
  }

  /** From when the instance has been empty, or undefined when it is not being tracked. */
  emptySince(instanceId: number): number | undefined {
    return this.idleSince.get(instanceId);
  }

  // ── Deadlines ───────────────────────────────────────────────────────────────

  /**
   * Epoch ms of the next moment something has to be re-evaluated (a grace ending, an idle TTL
   * reached), or null when nothing is pending.
   */
  nextDeadline(): number | null {
    if (this.idleTimeoutMs <= 0) return null;

    let next = Infinity;
    for (const since of this.idleSince.values())
      next = Math.min(next, since + this.idleTimeoutMs);
    for (const until of this.graceUntil.values()) next = Math.min(next, until);
    return Number.isFinite(next) ? next : null;
  }

  // ── Reporting ───────────────────────────────────────────────────────────────

  /**
   * Cleanup state of an instance, as reported by the API — the `lifecycle` field of a serialized
   * instance.
   *
   * Synchronous and cheap: it only reads the maps above, so the values are at most one scan
   * stale. `null` means "nothing to say" — no cleanup configured, or nothing to clean up yet.
   *
   * @returns the current state, or null when there is nothing to say: cleanup disabled, or the
   *          instance cannot be evaluated (e.g. its relay is offline — it is never removed then).
   */
  serialize(
    instanceId: number,
    tags: readonly string[] | null | undefined,
  ): ApiInstanceLifecycle | null {
    // Nothing is ever removed while the automatic cleanup is disabled.
    if (this.idleTimeoutMs <= 0) return null;

    // Pinned: never auto-removed.
    if (this.isPersistent(tags)) return { type: 'persistent' };

    // Just created / just reassigned: the idle timer has not started yet.
    const graceUntil = this.graceUntil.get(instanceId);
    if (graceUntil !== undefined && Date.now() < graceUntil)
      return {
        type: 'grace',
        key: this.graceKind.get(instanceId) ?? 'created',
        expires: graceUntil,
      };

    const since = this.idleSince.get(instanceId);
    if (since === undefined) return null;

    return { type: 'removal', at: since + this.idleTimeoutMs };
  }

  // ── Housekeeping ─────────────────────────────────────────────────────────────

  /** Forget an instance that lost its relay: it is not idle, it has nowhere to run. */
  unlink(instanceId: number): void {
    this.clearIdleTimer(instanceId);
  }

  /** Forget an instance entirely (deleted, or no longer exists). */
  forget(instanceId: number): void {
    this.clearIdleTimer(instanceId);
    this.graceUntil.delete(instanceId);
    this.graceKind.delete(instanceId);
  }

  /** Bulk startup pass: shield everything that exists right now. */
  graceAll(instanceIds: number[]): void {
    for (const id of instanceIds) this.grantGrace(id, 'startup');
  }

  /**
   * Forget the state of every instance that is not in `existing` — the grace deadlines of a
   * deleted instance would otherwise stay armed and keep a reaper scan scheduled for nothing.
   */
  forgetMissing(existing: ReadonlySet<number>): void {
    for (const id of [...this.graceUntil.keys()])
      if (!existing.has(id)) this.forget(id);
    for (const id of [...this.idleSince.keys()])
      if (!existing.has(id)) this.clearIdleTimer(id);
  }

  /** How long the given reason lasts, in seconds (for logging). */
  static graceSeconds(kind: InstanceGraceKind): number {
    return GRACE_SECONDS[kind];
  }
}
