import { NoxIdentifier } from '../common/identifier';

// ── Internal domain types ─────────────────────────────────────────────────────

/** One instance assigned to a relay (DB row subset). */
export interface RelayAssignedInstance {
    id: number;
    name: string;
    title: string | null;
    /** World reference as a NoxIdentifier */
    worldRef: NoxIdentifier;
    /** Owner reference as a NoxIdentifier */
    ownerRef: NoxIdentifier;
    capacity: number;
    createdAt: Date;
}

/** One instance slot sent back to the relay binary on request_instances. */
export interface RelayInstanceSlot {
    id: number;
    password: string | null;
    capacity: number;
    world: { id: number; address: string; version: number };
}

/** Resolved user returned to the relay binary on resolve_user. */
export interface RelayResolvedUser {
    result: 'success' | 'invalid_user' | 'blacklisted';
    error?: string;
    /** ISO date string when the blacklist expires, if applicable. */
    expire_at?: number;
    user?: { id: number; server: string; display: string };
}

/** Inbound log entry forwarded from the relay binary. */
export interface RelayLogEntry {
    relay_id: number;
    time: number;
    level: string;
    message: string;
    tag: string | null;
}

/** Inbound client connection event from the relay binary. */
export interface RelayClientEvent {
    relay_id: number;
    time: number;
    client: { id: number; address: string | null; platform: string; engine: string; user: string | null; connected_at: number };
}

/** Inbound client-disconnected event from the relay binary. */
export interface RelayClientDisconnectedEvent {
    relay_id: number;
    time: number;
    id: number;
    reason: string;
    type: string;
}

/** Inbound client-authentified event from the relay binary. */
export interface RelayClientAuthentifiedEvent {
    relay_id: number;
    time: number;
    client_id: number;
    user: string;
}

/** Inbound player-join event from the relay binary. */
export interface RelayPlayerJoinEvent {
    relay_id: number;
    time: number;
    player: {
        client_id: number;
        player_id: number;
        display: string;
        /** Relay-internal instance slot (0–254). */
        internal_id: number;
        flags: number;
        joined_at: number;
    };
}

/** Inbound player-leave event from the relay binary. */
export interface RelayPlayerLeaveEvent {
    relay_id: number;
    time: number;
    player: {
        player_id: number;
        /** Relay-internal instance slot (0–254). */
        internal_id: number;
        type: string;
        reason: string;
    };
}

/** Relay lifecycle event emitted to WS clients. */
export interface RelayStatusChangeEvent {
    relay_id: number;
    status: 'connected' | 'disconnected' | 'ready';
    time: number;
}

// ── Relay API response types ──────────────────────────────────────────────────

/** A player entry returned by the relay binary's get_players request. */
export interface RelayPlayer {
    /** Player instance ID */
    i: string;
    /** Client ID */
    c: string;
    /** Display name */
    d: string;
    /** Flags bitmask (bit 9 = HIDE_IN_LIST) */
    f: number;
    /** User identifier (e.g. "1@example.com"), null if unauthenticated */
    u: string | null;
}

export interface ApiRelayRunnerPort {
    protocol: string;
    host: string;
    port: number;
}

export interface ApiRelayRunnerInfo {
    provider_id: string | null;
    /** Lifecycle status: "running" | "stopped" | "dead" | "unknown" */
    status: string;
    started_at: number | null;
    meta: Record<string, string>;
    ports: ApiRelayRunnerPort[];
}

export interface ApiRelaySpecs {
    processor: {
        used: number;
        cores: number
    };
    memory: {
        used: number;
        total: number
    };
    upload: {
        used: number;
        bandwidth: number;
        packets: number;
    };
    download: {
        used: number;
        bandwidth: number;
        packets: number;
    };
    mtu: number;
}

export interface WsRelayAccessibility {
    quic?: string;
    tcp?: string;
    udp?: string;
    [key: string]: string | undefined;
}

export interface WsRelayStatus {
    i: number;
    m: number;
    c: number;
    e: string;
    v: string;
    p: number;
    u: number;
    s: WsRelaySpecs;
    a: WsRelayAccessibility;
    /** ISO 3166-1 alpha-2 region code (lowercase), e.g. "fr", null for worldwide */
    r: string | null;
}

export interface WsRelaySpecs {
    c: { u: number; c: number };
    m: { u: number; t: number };
    u: { u: number; b: number; p?: number };
    d: { u: number; b: number; p?: number };
    mtu?: number;
}

export interface ApiRelayStatus {
    instances: { count: number; limit: number };
    clients: number;
    engine: string | null;
    version: string | null;
    protocol: number | null;
    /** Relay process uptime in seconds */
    uptime: number | null;
    /** Round-trip latency for this status request in milliseconds */
    ping: number | null;
    specs: ApiRelaySpecs | null;
}

export interface ApiRelay {
    id: number;
    label: string | null;
    provider: string;
    provider_id: string | null;
    max_link: number;
    tags: string[];
    connected: boolean;
    runner: ApiRelayRunnerInfo | null;
    created_at: string;
    status: ApiRelayStatus | null;
}
