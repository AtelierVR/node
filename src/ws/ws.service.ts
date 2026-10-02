import { forwardRef, Inject, Injectable } from '@nestjs/common';
// A real import, not `import type`: a type-only import emits no DI metadata and Nest would then
// look for a `Function` token. WsGateway is not exported by WsModule on purpose, so this cycle
// stays internal to the websocket layer.
import { WsGateway } from './ws.gateway';
import { EventsService } from '../gateway/events.service';
import type { WebsocketFrame, WebsocketFrames } from '../events/websocket-frames';

/**
 * Public façade for client-facing events.
 *
 * This is the **client channel**, the counterpart of `EmitterService` (in-process bus):
 *
 * ```ts
 * this.emitter.emit(Events.RELAY_CREATED, payload);   // internal reaction
 * this.ws.emit(WsFrame.RELAY_CREATED, payload);       // clients
 * ```
 *
 * `emit` is typed against {@link WebsocketFrames}: only a frame declared in `websocket-frames.ts`
 * can leave the server, and only with a payload of the declared shape. A private domain event
 * cannot be pushed to clients by mistake — it is simply not a key of that map.
 *
 * It fans out to both transports (native `ws` and Socket.IO), so a service never has to know that
 * two gateways exist. Access control is not its business: the gateways ask
 * `WebsocketGuardRegistry`, which holds the `@OnWebsocketEventRegister` guards.
 *
 * Other modules should inject this service, never the gateways themselves.
 */
@Injectable()
export class WsService {
    constructor(
        // The gateway is the native transport this service fans out to; it also injects WsService
        // to send presence frames, hence the forwardRef.
        @Inject(forwardRef(() => WsGateway))
        private readonly gateway: WsGateway,
        private readonly socketIo: EventsService,
    ) { }

    /**
     * Send a frame to every client subscribed to its room, on both transports.
     * Clients receive: `{ type: "event", payload: { name, data } }`
     */
    emit<TFrame extends WebsocketFrame>(name: TFrame, data: WebsocketFrames[TFrame]): void {
        this.gateway.emit(name, data);
        this.socketIo.emit(name, data);
    }

    /**
     * Broadcast a raw frame to ALL connected clients (regardless of room).
     *
     * Reserved for protocol-level frames (relay requests, hello/pong): it bypasses room
     * subscriptions, so it is never used for domain data.
     */
    broadcast<T = unknown>(type: string, payload: T): void {
        this.gateway.broadcast(type, payload);
    }

    /** Send a frame to every socket of one user, whatever their subscriptions. */
    emitToUser<TFrame extends WebsocketFrame>(userId: number, name: TFrame, data: WebsocketFrames[TFrame]): void {
        this.gateway.emitToUser(userId, name, data);
        this.socketIo.emitToUser(userId, name, data);
    }

    /**
     * Check if a user has at least one active WebSocket connection.
     */
    isUserConnected(userId: number): boolean {
        return this.gateway.isUserConnected(userId);
    }

    /**
     * Check if a specific session has at least one active WebSocket connection.
     */
    isSessionConnected(sessionId: string): boolean {
        return this.gateway.isSessionConnected(sessionId);
    }
}
