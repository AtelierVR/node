/**
 * Catalogue of the in-process domain events.
 *
 * **Internal only** — nothing here reaches a client. Services publish with
 * `EmitterService.emit(Events.X, payload)` and react with `@OnEvent(Events.X)`. Pushing something
 * to browsers is a separate, explicit decision, described in `websocket-frames.ts`.
 *
 * ## Naming: the three tiers
 *
 * The same fact can travel through up to three channels, and each one has its own shape:
 *
 * | Channel    | Naming            | What it is |
 * | ---------- | ----------------- | ---------- |
 * | in-process | `<Type>Event`     | the fact as the services understand it — ids, internal fields |
 * | WebSocket  | `ApiWs<Type>`     | the sanitised subset a client may see (see `websocket-frames.ts`) |
 * | REST       | `Api<Type>`       | the sanitised body of a request/response (see the `dto/` folders) |
 *
 * A `<Type>Event` is therefore never sent anywhere: `this.emitter.emit(Events.X, event)` stays in
 * the process, and `this.ws.emit(WsFrames.X, frame)` sends the `ApiWs<…>` built from it. Sanitising
 * is what keeps internal-only fields (`provider_id`, connection payloads, TPS overrides) from
 * leaking by accident — the compiler enforces that the two shapes are different.
 *
 * The payload map is checked at compile time: a typo in the name or a missing field does not
 * compile.
 */

import type {
  ApiRelaySpecs,
  RelayClientAuthentifiedFrame,
  RelayClientDisconnectedFrame,
  RelayClientFrame,
  RelayInstanceSettingsFrame,
  RelayLogFrame,
  RelayPlayerJoinFrame,
  RelayPlayerLeaveFrame,
} from '../relay/relay.types';

// ── Instances ────────────────────────────────────────────────────────────────

/** An instance was created and persisted. Emitted *after* the row exists. */
export interface InstanceCreatedEvent {
  instance_id: number;
  /** Relay it is assigned to, or null while it waits for one. */
  relay_id: number | null;
  time: number;
}

/** An instance's mutable fields changed. */
export interface InstanceUpdatedEvent {
  instance_id: number;
  /** Names of the columns that changed (e.g. `['title', 'capacity']`). */
  fields: string[];
  time: number;
}

/** An instance is gone. Emitted *after* the row is deleted. */
export interface InstanceRemovedEvent {
  instance_id: number;
  /** Relay it was assigned to when it disappeared, or null. */
  relay_id: number | null;
  /** Why it went away: `deleted`, `idle_timeout`, … */
  reason: string;
  time: number;
}

/**
 * An instance's automatic-cleanup state changed: it left a grace period and now has a scheduled
 * removal (or the other way round).
 *
 * Published by the instance reaper, which is the only component that owns the idle timer — nothing
 * else can observe that transition. Whoever serializes instances turns it into a client signal, so
 * the UI does not have to poll to see grace → removal.
 */
export interface InstanceLifecycleChangeEvent {
  instance_id: number;
  /** Relay hosting it, or null while unassigned. */
  relay_id: number | null;
  lifecycle: 'grace' | 'removal';
  time: number;
}

// ── Relays ───────────────────────────────────────────────────────────────────

/** A relay row was created (by the relay creator or an admin action). */
export interface RelayCreatedEvent {
  relay_id: number;
  provider: string;
  time: number;
}

/** A relay's mutable fields changed (label, tags, max links, …). */
export interface RelayUpdatedEvent {
  relay_id: number;
  fields: string[];
  time: number;
}

/** A relay row was deleted. */
export interface RelayRemovedEvent {
  relay_id: number;
  /** Why it went away, when known (e.g. `idle`, `dead`). */
  reason?: string;
  time: number;
}

/** A relay's socket authenticated, or dropped. */
export interface RelayConnectionEvent {
  relay_id: number;
  time: number;
}

/**
 * A relay's observable status changed.
 *
 * `up`/`down` come from the provider runner (process started / died), the others from the relay's
 * own socket or handshake.
 */
export interface RelayStatusChangeEvent {
  relay_id: number;
  status: 'connected' | 'disconnected' | 'ready' | 'up' | 'down';
  time: number;
}

/** The relay's auto-cleanup state changed (grace granted/expired, removal scheduled/cleared). */
export interface RelayLifecycleChangeEvent {
  relay_id: number;
  time: number;
}

/** Live specs reported by the relay process. */
export interface RelaySpecsUpdateEvent {
  relay_id: number;
  details: ApiRelaySpecs;
  time: number;
}

/**
 * An instance was (re)linked to a relay, freed from one, or deleted while linked.
 *
 * Assignment lives in the `relay_instances` table, which no relay frame describes: this is the only
 * signal the DB-backed "assigned instances" views get.
 */
export interface RelayInstanceAssignmentEvent {
  relay_id: number;
  instance_id: number;
  action: 'assigned' | 'unassigned' | 'deleted';
  time: number;
}

// ── Catalogue ────────────────────────────────────────────────────────────────

/** Event name → payload. Kept exhaustive: adding a name without its payload does not compile. */
export interface DomainEvents {
  'instance.created': InstanceCreatedEvent;
  'instance.updated': InstanceUpdatedEvent;
  'instance.removed': InstanceRemovedEvent;
  'instance.lifecycle': InstanceLifecycleChangeEvent;

  'relay.created': RelayCreatedEvent;
  'relay.updated': RelayUpdatedEvent;
  'relay.removed': RelayRemovedEvent;
  'relay.connected': RelayConnectionEvent;
  'relay.disconnected': RelayConnectionEvent;
  'relay.status': RelayStatusChangeEvent;
  'relay.specs': RelaySpecsUpdateEvent;
  'relay.lifecycle': RelayLifecycleChangeEvent;
  'relay.logs': RelayLogFrame;

  'relay.instance.assigned': RelayInstanceAssignmentEvent;
  'relay.instance.unassigned': RelayInstanceAssignmentEvent;
  'relay.instance.settings': RelayInstanceSettingsFrame;

  'relay.client.connected': RelayClientFrame;
  'relay.client.disconnected': RelayClientDisconnectedFrame;
  'relay.client.authentified': RelayClientAuthentifiedFrame;
  'relay.player.join': RelayPlayerJoinFrame;
  'relay.player.leave': RelayPlayerLeaveFrame;
}

export type DomainEventName = keyof DomainEvents;

/**
 * The names themselves, for the places that cannot take a type: `@OnEvent(Events.RELAY_CONNECTED)`
 * and `emit(Events.X, …)`.
 */
export const Events = {
  INSTANCE_CREATED: 'instance.created',
  INSTANCE_UPDATED: 'instance.updated',
  INSTANCE_REMOVED: 'instance.removed',
  INSTANCE_LIFECYCLE: 'instance.lifecycle',

  RELAY_CREATED: 'relay.created',
  RELAY_UPDATED: 'relay.updated',
  RELAY_REMOVED: 'relay.removed',
  RELAY_CONNECTED: 'relay.connected',
  RELAY_DISCONNECTED: 'relay.disconnected',
  RELAY_STATUS: 'relay.status',
  RELAY_SPECS: 'relay.specs',
  RELAY_LIFECYCLE: 'relay.lifecycle',
  RELAY_LOGS: 'relay.logs',

  RELAY_INSTANCE_ASSIGNED: 'relay.instance.assigned',
  RELAY_INSTANCE_UNASSIGNED: 'relay.instance.unassigned',
  RELAY_INSTANCE_SETTINGS: 'relay.instance.settings',

  RELAY_CLIENT_CONNECTED: 'relay.client.connected',
  RELAY_CLIENT_DISCONNECTED: 'relay.client.disconnected',
  RELAY_CLIENT_AUTHENTIFIED: 'relay.client.authentified',
  RELAY_PLAYER_JOIN: 'relay.player.join',
  RELAY_PLAYER_LEAVE: 'relay.player.leave',
} as const satisfies Record<string, DomainEventName>;
