/**
 * Catalogue of the frames the WebSocket layer may put on the wire.
 *
 * **Client-facing** — the opposite channel from `domain-events.ts` (in-process bus).
 *
 * ## Naming: the three tiers
 *
 * | Channel    | Naming        | What it is |
 * | ---------- | ------------- | ---------- |
 * | in-process | `<Type>Event` | the fact as the services understand it |
 * | WebSocket  | `ApiWs<Type>` | **this file** — the sanitised subset a client may see |
 * | REST       | `Api<Type>`   | the sanitised body of a request/response (see the `dto/` folders) |
 *
 * Every payload is an `ApiWs<…>`: an interface written from scratch, never the `<Type>Event` it
 * comes from. That is the whole point — a service that holds a `RelayClientEvent` (with the client IP
 * it authenticated from, a `provider_id`, a base64 connection token…) cannot hand it to
 * `this.ws.emit()` without the compiler complaining about the extra fields, so nothing internal
 * leaks by accident.
 *
 * Building one is always explicit, at the emit site:
 *
 * ```ts
 * this.emitter.emit(Events.RELAY_CREATED, created);            // internal
 * this.ws.emit(WsFrames.RELAY_CREATED, {                       // sanitised
 *     relay_id: created.relay_id,
 *     provider: created.provider,
 *     time: created.time,
 * });
 * ```
 *
 * Only frames listed here may leave the server. Mirrored in `front/src/lib/ws/events.ts`: when a
 * frame changes, the front's `useWsEvent` handler changes with it.
 */
import type { ApiActivityEvent } from '../activity/activity.types';
import type { ApiRelaySpecs } from '../relay/relay.types';

/** Frames that are an implementation detail of the relay protocol and must never be forwarded. */
export const INTERNAL_ONLY_FRAMES = [
  'relay.connected',
  'relay.disconnected',
] as const;

// ── Instances ────────────────────────────────────────────────────────────────

/** Client-safe view of {@link InstanceCreatedEvent}. */
export interface ApiWsInstanceCreated {
  instance_id: number;
  time: number;
}

/** Client-safe view of {@link InstanceUpdatedEvent}: which fields changed, never their values. */
export interface ApiWsInstanceUpdated {
  instance_id: number;
  fields: string[];
  time: number;
}

/** Client-safe view of {@link InstanceRemovedEvent}. */
export interface ApiWsInstanceRemoved {
  instance_id: number;
  reason: string;
  time: number;
}

/** Client-safe view of {@link InstanceLifecycleChangeEvent}. */
export interface ApiWsInstanceLifecycle {
  instance_id: number;
  /** Relay whose page shows the badge, or null while unassigned. */
  relay_id: number | null;
  lifecycle: 'grace' | 'removal';
  time: number;
}

// ── Relays ───────────────────────────────────────────────────────────────────

/** Client-safe view of {@link RelayCreatedEvent}. */
export interface ApiWsRelayCreated {
  relay_id: number;
  provider: string;
  time: number;
}

/** Client-safe view of {@link RelayRemovedEvent}. */
export interface ApiWsRelayRemoved {
  relay_id: number;
  time: number;
}

/** Client-safe view of {@link RelayStatusChangeEvent}. */
export interface ApiWsRelayStatus {
  relay_id: number;
  status: 'connected' | 'disconnected' | 'ready' | 'up' | 'down';
  time: number;
}

/** Client-safe view of {@link RelayLifecycleChangeEvent}: a signal only, never the computed state. */
export interface ApiWsRelayLifecycle {
  relay_id: number;
  time: number;
}

/** Client-safe view of {@link RelaySpecsUpdateEvent}. */
export interface ApiWsRelaySpecs {
  relay_id: number;
  details: ApiRelaySpecs;
  time: number;
}

/** Client-safe view of `RelayLogEntry`: the relay's own id is implied by the subscription. */
export interface ApiWsRelayLog {
  time: number;
  level: string;
  message: string;
  tag: string | null;
}

/** Client-safe view of {@link RelayInstanceAssignmentEvent}. */
export interface ApiWsRelayInstanceAssignment {
  relay_id: number;
  instance_id: number;
  action: 'assigned' | 'unassigned' | 'deleted';
  time: number;
}

/** Client-safe view of {@link RelayInstanceSettingsChangedEvent}. */
export interface ApiWsRelayInstanceSettings {
  relay_id: number;
  internal_id: number;
  tps: number;
  threshold: number;
  time: number;
}

/** Client-safe view of `RelayClientEvent`: no connection address, no platform fingerprint. */
export interface ApiWsRelayClientConnected {
  relay_id: number;
  id: number;
  engine: string;
  user: string | null;
  connected_at: number;
  time: number;
}

/** Client-safe view of `RelayClientDisconnectedEvent`. */
export interface ApiWsRelayClientDisconnected {
  relay_id: number;
  id: number;
  type: string;
  time: number;
}

/** Client-safe view of `RelayClientAuthentifiedEvent`. */
export interface ApiWsRelayClientAuthentified {
  relay_id: number;
  client_id: number;
  user: string;
  time: number;
}

/** Client-safe view of `RelayPlayerJoinEvent`: the connection address is dropped. */
export interface ApiWsRelayPlayerJoin {
  relay_id: number;
  client_id: number;
  player_id: number;
  display: string;
  internal_id: number;
  joined_at: number;
  time: number;
}

/** Client-safe view of `RelayPlayerLeaveEvent`. */
export interface ApiWsRelayPlayerLeave {
  relay_id: number;
  player_id: number;
  internal_id: number;
  type: string;
  time: number;
}

// ── Misc ─────────────────────────────────────────────────────────────────────

/** Presence of one user, as broadcast to the rooms that may see them. */
export interface ApiWsUserPresence {
  user: string;
  status: string;
  text: string | null;
  locations: string[] | null;
}

/** One side of a follow relation, for the two users involved. */
export interface ApiWsUserRelation {
  user: string;
  out: string | null;
  in: string | null;
}

/** A notification pushed to its recipient's clients. `type` carries the kind. */
export interface ApiWsNotification<T = any> {
  type: string;
  key: string | null;
  from: string | null;
  data: T | null;
}

export interface ApiWsServerLog {
  timestamp: number;
  level: string;
  message: string;
  tag: string | null;
}

// ── Catalogue ────────────────────────────────────────────────────────────────

/** Frame name → payload. */
export interface WebsocketFrames {
  activity: ApiActivityEvent;
  server_logs: ApiWsServerLog;
  'user:presence': ApiWsUserPresence;
  'user:relation': ApiWsUserRelation;
  'notification': ApiWsNotification;

  'instance.created': ApiWsInstanceCreated;
  'instance.updated': ApiWsInstanceUpdated;
  'instance.removed': ApiWsInstanceRemoved;
  'instance.lifecycle': ApiWsInstanceLifecycle;

  'relay.created': ApiWsRelayCreated;
  'relay.removed': ApiWsRelayRemoved;
  'relay.status': ApiWsRelayStatus;
  'relay.lifecycle': ApiWsRelayLifecycle;
  'relay.logs': ApiWsRelayLog;
  'relay.specs': ApiWsRelaySpecs;

  'relay.instance.assigned': ApiWsRelayInstanceAssignment;
  'relay.instance.unassigned': ApiWsRelayInstanceAssignment;
  'relay.instance.settings': ApiWsRelayInstanceSettings;

  'relay.client.connected': ApiWsRelayClientConnected;
  'relay.client.disconnected': ApiWsRelayClientDisconnected;
  'relay.client.authentified': ApiWsRelayClientAuthentified;
  'relay.player.join': ApiWsRelayPlayerJoin;
  'relay.player.leave': ApiWsRelayPlayerLeave;
}

export const WsFrames = {
  ACTIVITY: 'activity',
  SERVER_LOGS: 'server_logs',
  USER_PRESENCE: 'user:presence',
  USER_RELATION: 'user:relation',
  NOTIFICATION: 'notification',

  INSTANCE_CREATED: 'instance.created',
  INSTANCE_UPDATED: 'instance.updated',
  INSTANCE_REMOVED: 'instance.removed',
  INSTANCE_LIFECYCLE: 'instance.lifecycle',

  RELAY_CREATED: 'relay.created',
  RELAY_REMOVED: 'relay.removed',
  RELAY_STATUS: 'relay.status',
  RELAY_LIFECYCLE: 'relay.lifecycle',
  RELAY_LOGS: 'relay.logs',
  RELAY_SPECS: 'relay.specs',

  RELAY_INSTANCE_ASSIGNED: 'relay.instance.assigned',
  RELAY_INSTANCE_UNASSIGNED: 'relay.instance.unassigned',
  RELAY_INSTANCE_SETTINGS: 'relay.instance.settings',

  RELAY_CLIENT_CONNECTED: 'relay.client.connected',
  RELAY_CLIENT_DISCONNECTED: 'relay.client.disconnected',
  RELAY_CLIENT_AUTHENTIFIED: 'relay.client.authentified',
  RELAY_PLAYER_JOIN: 'relay.player.join',
  RELAY_PLAYER_LEAVE: 'relay.player.leave',
} as const satisfies Record<string, keyof WebsocketFrames>;

/** A frame a client may subscribe to. */
export type WebsocketFrame = Exclude<
  (typeof WsFrames)[keyof typeof WsFrames],
  (typeof INTERNAL_ONLY_FRAMES)[number]
>;
