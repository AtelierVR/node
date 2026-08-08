import { Injectable } from '@nestjs/common';
import { WsGateway } from './ws.gateway';
import type { WsRoomValidator } from './ws.types';

/**
 * Public façade for the native WebSocket server.
 * Other modules should inject WsService instead of WsGateway directly.
 */
@Injectable()
export class WsService {
    constructor(private readonly gateway: WsGateway) { }

    /**
     * Emit an event payload to all clients subscribed to the named room.
     * Clients receive: `{ type: "event", payload: { name, data } }`
     */
    emit<T = unknown>(name: string, data: T): void {
        this.gateway.emit(name, data);
    }

    /**
     * Broadcast a raw frame to ALL connected clients (regardless of room).
     */
    broadcast<T = unknown>(type: string, payload: T): void {
        this.gateway.broadcast(type, payload);
    }

    /**
     * Emit an event payload to all sockets belonging to a specific user.
     */
    emitToUser<T = unknown>(userId: number, name: string, data: T): void {
        this.gateway.emitToUser(userId, name, data);
    }

    /**
     * Register a room-level access validator.
     * Called by other modules to gate privileged rooms (e.g. admin-only).
     */
    registerValidator(name: string, fn: WsRoomValidator): void {
        this.gateway.registerValidator(name, fn);
    }

    /**
     * Check if a user has at least one active WebSocket connection.
     */
    isUserConnected(userId: number): boolean {
        return this.gateway.isUserConnected(userId);
    }
}
