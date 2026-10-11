/**
 * API shape of an instance's automatic cleanup state, computed by the `InstanceReaper`
 * (relay module) and serialized by `InstancesService`.
 *
 * `null` means "nothing to report": automatic cleanup is disabled, or the instance cannot be
 * evaluated (for example its relay is offline) — such an instance is never removed.
 */

/** Reasons an instance can be in a grace period — the UI maps them to `admin.instance_grace_<kind>`. */
export type InstanceGraceKind =
  /** The instance was just created and its idle timer has not started yet. */
  | 'created'
  /** The instance was just (re)assigned to a relay — it has not been hosted there yet. */
  | 'assigned'
  /** The node just started: every existing instance is shielded while the relays reconnect. */
  | 'startup';

export type ApiInstanceLifecycle =
  /** Pinned with a moderation-namespace `persistent` tag (e.g. `sys:persistent`): never removed. */
  | { type: 'persistent' }
  /**
   * Grace period currently protecting the instance.
   *
   * `key` is the reason — `created` for a freshly created instance, `assigned` when it was just
   * (re)assigned to a relay — and `expires` the deadline in epoch ms. Both keep the idle timer
   * from starting before the instance had a chance to be hosted and joined.
   */
  | { type: 'grace'; key: InstanceGraceKind; expires: number }
  /** Scheduled removal: `at` is the estimated epoch ms (idle timeout reached). */
  | { type: 'removal'; at: number };
