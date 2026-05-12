import type { WebSocket } from 'ws';
import type { UserWithMethods } from '../users/user.model';

/** Auth mode resolved at connection time. */
export type WsAuthMode = 'guest' | 'user' | 'relay';

/** Per-client runtime state stored via clientMap. */
export interface WsClientData {
    mode: WsAuthMode;
    /** Unique socket identifier for this connection */
    socketId: string;
    /** Populated when mode === 'user' */
    user?: UserWithMethods;
    /** Populated when mode === 'relay' */
    relayId?: number;
    /** Room subscriptions */
    rooms: Set<string>;
    /** Instance the user is currently in, with the timestamp when the packet was sent */
    instance?: { iid: string; at: number } | null;
}

/** Inbound JSON frame sent by clients. */
export interface WsInboundFrame<T = unknown | undefined> {
    type: string;
    payload: T;
    /** Optional correlation ID for request/response */
    id?: string;
    [key: string]: unknown;
}

/** Room validator: returns true if the client is allowed to subscribe. */
export type WsRoomValidator = (data: WsClientData, ws: WebSocket) => Promise<boolean>;
