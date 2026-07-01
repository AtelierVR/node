import {
    Injectable,
    Logger,
    OnModuleInit,
    OnModuleDestroy,
    Inject,
    forwardRef,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { WebSocketServer, WebSocket, RawData } from 'ws';
import type { IncomingMessage } from 'http';
import { EventsService } from '../gateway/events.service';
import { SessionService } from '../auth/session.service';
import { UsersService } from '../users/users.service';
import { RelayService } from '../relay/relay.service';
import { AppConfigService } from '../config/config.service';
import type {
    WsAuthMode,
    WsClientData,
    WsInboundFrame,
    WsRoomValidator,
} from './ws.types';
import { randomBytes } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { PRESENCE_TO_API, PRESENCE_VISIBILITY } from '../users/users.types';
import type { RelayPlayer, WsRelayStatus } from '../relay/relay.types';

@Injectable()
export class WsGateway implements OnModuleInit, OnModuleDestroy {

    private readonly logger = new Logger(WsGateway.name);

    /** Underlying ws server, attached to the existing HTTP server at /ws. */
    private wss!: WebSocketServer;

    /** Per-client metadata (mode, user/relay identity, subscribed rooms). */
    private readonly clients = new WeakMap<WebSocket, WsClientData>();

    /** Room name → connected sockets that subscribed to that room. */
    private readonly rooms = new Map<string, Set<WebSocket>>();

    /** User ID → connected sockets (for per-user targeted events). */
    private readonly userSockets = new Map<number, Set<WebSocket>>();

    /** Optional per-room access validators registered by other modules. */
    private readonly validators = new Map<string, WsRoomValidator>();

    /** Pending relay requests awaiting response (correlation ID → resolver). */
    private readonly pendingRequests = new Map<string, {
        resolve: (value: any) => void;
        reject: (error: any) => void;
        timeout: NodeJS.Timeout;
    }>();

    constructor(
        private readonly httpAdapterHost: HttpAdapterHost,
        private readonly sessions: SessionService,
        private readonly config: AppConfigService,
        @Inject(forwardRef(() => UsersService))
        private readonly users: UsersService,
        @Inject(forwardRef(() => RelayService))
        private readonly relayService: RelayService,
        private readonly eventsService: EventsService,
        private readonly prisma: PrismaService,
    ) { }

    // ── NestJS lifecycle ───────────────────────────────────────────────────

    async onModuleInit(): Promise<void> {
        const httpServer = this.httpAdapterHost.httpAdapter.getHttpServer();

        // Read the configured HTTP prefix (default: 'api') to match the NestJS global prefix.
        // gateway.ws is typically e.g. wss://example.com/api/ws, so the path must include it.
        const prefix = await this.config.get<string>('http.prefix').catch(() => 'api');
        const path = prefix ? `/${prefix}/ws` : '/ws';

        this.wss = new WebSocketServer({ server: httpServer, path });
        this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) =>
            void this.handleConnection(ws, req),
        );

        this.logger.log(`Native WebSocket server listening on ${path}`);

        // Register this gateway with EventsService so it can broadcast to native WebSocket clients
        this.eventsService.registerWsGateway(this);
    }

    onModuleDestroy(): void {
        // Clean up pending requests
        for (const [id, pending] of this.pendingRequests.entries()) {
            clearTimeout(pending.timeout);
            pending.reject(new Error('Gateway shutting down'));
        }
        this.pendingRequests.clear();
        this.wss?.close();
    }

    // ── Connection ─────────────────────────────────────────────────────────

    private async handleConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
        const { mode, token } = this.extractAuth(req);
        const socketId = `ws-${randomBytes(8).toString('hex')}`;
        const data: WsClientData = { mode, socketId, rooms: new Set() };
        this.clients.set(ws, data);

        // Register handlers immediately so messages sent during async auth are buffered,
        // not silently dropped (e.g. relay sends request_instances right after connect).
        const buffer: RawData[] = [];
        const bufferingHandler = (raw: RawData) => buffer.push(raw);
        ws.on('message', bufferingHandler);
        ws.on('close', () => this.handleDisconnect(ws));
        ws.on('error', (err: Error) =>
            this.logger.warn('WebSocket client error: ' + err.message),
        );

        if (mode === 'user') {
            await this.resolveUser(ws, data, token!);
        } else if (mode === 'relay') {
            await this.resolveRelay(ws, data, token!);
        } else {
            // Guest — allowed without any credentials
            this.sendFrame(ws, 'hello', { mode: 'guest' });
            // this.logger.debug('Guest connected');
        }

        // Swap buffering handler for real handler, then replay any buffered messages.
        ws.off('message', bufferingHandler);
        ws.on('message', (raw: RawData) => this.handleMessage(ws, raw));
        for (const raw of buffer) this.handleMessage(ws, raw);
    }

    private async resolveUser(ws: WebSocket, data: WsClientData, token: string): Promise<void> {
        const session = await this.sessions.findSessionByToken(token);
        if (!session || new Date(session.expires) < new Date()) {
            this.sendFrame(ws, 'error', { code: 'INVALID_TOKEN', message: 'Session expired or not found' });
            ws.close(1008, 'Invalid token');
            return;
        }

        const user = await this.users.findById(session.userId);
        if (!user) {
            this.sendFrame(ws, 'error', { code: 'USER_NOT_FOUND', message: 'Associated user not found' });
            ws.close(1008, 'User not found');
            return;
        }

        data.user = user;
        if (!this.userSockets.has(user.id)) this.userSockets.set(user.id, new Set());
        this.userSockets.get(user.id)!.add(ws);
        this.sendFrame(ws, 'hello', {
            mode: 'user',
            user: await user.sanitizeCurrent(),
        });
        // this.logger.debug('User "' + user.username + '" connected');
    }

    private async resolveRelay(ws: WebSocket, data: WsClientData, token: string): Promise<void> {
        const relay = await this.relayService.findByToken(token);
        if (!relay) {
            this.sendFrame(ws, 'error', { code: 'INVALID_RELAY_TOKEN', message: 'Relay token not found' });
            ws.close(1008, 'Invalid relay token');
            return;
        }

        data.relayId = relay.id;
        this.relayService.registerSocket(data.socketId, relay.id);
        this.sendFrame(ws, 'hello', { mode: 'relay', relayId: relay.id });
        this.logger.debug('Relay #' + relay.id + ' connected');
    }

    // ── Auth extraction ────────────────────────────────────────────────────

    /**
     * Determines the auth mode and token from the HTTP Upgrade request.
     *
     * Priority:
     *   1. Authorization: Bearer <token>  → user
     *   2. Authorization: Badger <token>  → relay
     *   3. Cookie: _uid=<token>           → user
     *   4. ?auth=<token> query param      → user (browser WebSocket API)
     *   5. No credentials                 → guest
     */
    private extractAuth(req: IncomingMessage): { mode: WsAuthMode; token: string | null } {
        const auth = req.headers.authorization ?? '';
        if (auth) {
            const lower = auth.toLowerCase();
            if (lower.startsWith('bearer ')) return { mode: 'user',  token: auth.slice(7).trim() };
            if (lower.startsWith('badger ')) return { mode: 'relay', token: auth.slice(7).trim() };
        }

        const cookie = req.headers.cookie ?? '';
        if (cookie) {
            const m = cookie.match(/(?:^|;\s*)_uid=([^;]+)/);
            if (m) return { mode: 'user', token: decodeURIComponent(m[1]) };
        }

        const url = req.url ?? '';
        const qIdx = url.indexOf('?');
        if (qIdx !== -1) {
            const qs = new URLSearchParams(url.slice(qIdx + 1));
            const q = qs.get('auth');
            if (q) return { mode: 'user', token: q };
        }

        return { mode: 'guest', token: null };
    }

    // ── Disconnect ─────────────────────────────────────────────────────────

    private handleDisconnect(ws: WebSocket): void {
        const data = this.clients.get(ws);
        if (!data) return;

        for (const room of data.rooms) {
            const set = this.rooms.get(room);
            if (set) { set.delete(ws); if (set.size === 0) this.rooms.delete(room); }
        }

        if (data.mode === 'user') {
            // this.logger.debug('User "' + (data.user?.username ?? '?') + '" disconnected');
            if (data.user) {
                const set = this.userSockets.get(data.user.id);
                if (set) { 
                    set.delete(ws); 
                    if (set.size === 0) 
                        this.userSockets.delete(data.user.id); 
                }
                void this._emitPresenceEvent(data.user.id);
            }
        }
        if (data.mode === 'relay') {
            if (data.relayId) {
                this.logger.debug('Relay #' + data.relayId + ' disconnected');
                this.relayService.unregisterSocket(data.socketId);
            }
        }

        this.clients.delete(ws);
    }

    // ── Message dispatch ───────────────────────────────────────────────────

    private handleMessage(ws: WebSocket, raw: RawData): void {
        let frame: WsInboundFrame;
        try {
            frame = JSON.parse(raw.toString()) as WsInboundFrame;
        } catch {
            this.sendFrame(ws, 'error', { code: 'INVALID_JSON', message: 'Message is not valid JSON' });
            return;
        }

        const data = this.clients.get(ws);
        if (!data) return;  

        switch (frame.type) {
            case 'ping':       this.onPing(ws, frame); break;
            case 'subscribe':  void this.onSubscribe(ws, data, frame); break;
            case 'unsubscribe': this.onUnsubscribe(ws, data, frame); break;
            case 'set_location': void this.onSetLocation(ws, data, frame); break;
            case 'log':        this.onLog(ws, data, frame); break;
            case 'specs':      this.onSpecs(ws, data, frame); break;
            case 'request_instances':    this.onRequestInstances(ws, data, frame); break;
            case 'resolve_user':         this.onResolveUser(ws, data, frame); break;
            case 'relay_sync_instances': this.onSyncInstances(ws, data, frame); break;
            case 'client_connected':     this.onClientConnected(ws, data, frame); break;
            case 'client_disconnected':  this.onClientDisconnected(ws, data, frame); break;
            case 'client_authentified':  this.onClientAuthentified(ws, data, frame); break;
            case 'player_join':          this.onPlayerJoin(ws, data, frame); break;
            case 'player_leave':         this.onPlayerLeave(ws, data, frame); break;
            case 'instance_settings_changed': this.onInstanceSettingsChanged(ws, data, frame); break;
            case 'logs':                 this.onLogsResponse(ws, data, frame); break;
            case 'status':               this.onStatusResponse(ws, data, frame); break;
            case 'get_instances':        this.onInstancesResponse(ws, data, frame); break;
            case 'get_clients':          this.onClientsResponse(ws, data, frame); break;
            case 'get_players':          this.onPlayersResponse(ws, data, frame); break;
            default:
                // Silently ignore unknown message types to avoid error loops
                this.logger.debug(`Unknown message type from ${data.mode}: "${frame.type}"`);
        }
    }

    private onPing(ws: WebSocket, frame: WsInboundFrame): void {
        const p = frame.payload as { time?: number } | undefined;
        this.sendFrame(ws, 'pong', { time: Date.now(), received: p?.time ?? 0 });
    }

    private async onSubscribe(ws: WebSocket, data: WsClientData, frame: WsInboundFrame): Promise<void> {
        const payload = frame.payload as { events?: unknown } | undefined;
        const events = payload?.events;
        if (!Array.isArray(events)) {
            this.sendFrame(ws, 'error', { code: 'INVALID_PAYLOAD', message: '`events` must be an array' });
            return;
        }

        const subscribed: string[] = [];
        const denied: string[]     = [];

        for (const event of events) {
            if (typeof event !== 'string' || event.length === 0) continue;
            const validator = this.validators.get(event);
            if (validator && !(await validator(data, ws))) { denied.push(event); continue; }
            if (!this.rooms.has(event)) this.rooms.set(event, new Set());
            this.rooms.get(event)!.add(ws);
            data.rooms.add(event);
            subscribed.push(event);
        }

        // Log successful subscriptions
        // if (subscribed.length > 0) {
        //     const clientInfo = data.mode === 'user' 
        //         ? `User ${data.user?.username ?? '?'}` 
        //         : data.mode === 'relay' 
        //             ? `Relay #${data.relayId}` 
        //             : 'Guest';
        //     this.logger.log(`${clientInfo} subscribed to: ${subscribed.join(', ')}`);
        // }

        this.sendFrame(ws, 'subscribed', { subscribed, ...(denied.length ? { denied } : {}) });
    }

    private onUnsubscribe(ws: WebSocket, data: WsClientData, frame: WsInboundFrame): void {
        const payload = frame.payload as { events?: unknown } | undefined;
        const events = payload?.events;
        if (!Array.isArray(events)) {
            this.sendFrame(ws, 'error', { code: 'INVALID_PAYLOAD', message: '`events` must be an array' });
            return;
        }

        const unsubscribed: string[] = [];
        for (const event of events) {
            if (typeof event !== 'string') continue;
            const set = this.rooms.get(event);
            if (set) { set.delete(ws); if (set.size === 0) this.rooms.delete(event); }
            data.rooms.delete(event);
            unsubscribed.push(event);
        }

        // Log successful unsubscriptions
        // if (unsubscribed.length > 0) {
        //     const clientInfo = data.mode === 'user' 
        //         ? `User ${data.user?.username ?? '?'}` 
        //         : data.mode === 'relay' 
        //             ? `Relay #${data.relayId}` 
        //             : 'Guest';
        //     this.logger.log(`${clientInfo} unsubscribed from: ${unsubscribed.join(', ')}`);
        // }

        this.sendFrame(ws, 'unsubscribed', { unsubscribed });
    }

    // ── Relay message handlers ────────────────────────────────────────────

    /**
     * `set_location` — declare the instance the user is currently in.
     * Payload: `string` — instance iid (e.g. "42@hactazia.fr") to enter, or `null` to leave all.
     * Sending the same iid a second time leaves that instance.
     * Responds: `{ locations: string[] }` — the updated location list.
     * Also emits `user:presence` to subscribers.
     */
    private async onSetLocation(ws: WebSocket, data: WsClientData, frame: WsInboundFrame): Promise<void> {
        if (data.mode !== 'user' || !data.user) {
            this.sendFrame(ws, 'error', { code: 'FORBIDDEN', message: 'set_location requires authentication' }, frame.id);
            return;
        }

        const raw = frame.payload;
        const userId = data.user.id;

        if (raw === null || raw === undefined) {
            // Leave this socket's current instance
            data.instance = null;
            const locations = this.getLocationsForUser(userId);
            this.sendFrame(ws, 'location_set', { locations }, frame.id);
            await this._emitPresenceEvent(userId);
            this.logger.debug(`User "${data.user.username}" left all locations`);
            return;
        }

        if (typeof raw !== 'string' || raw.trim() === '') {
            this.sendFrame(ws, 'error', { code: 'BAD_REQUEST', message: 'payload must be an instance iid string or null' }, frame.id);
            return;
        }
        // Validate format: "<numericId>@<server>"
        const match = raw.trim().match(/^(\d+)@(.+)$/);
        if (!match) {
            this.sendFrame(ws, 'error', { code: 'BAD_REQUEST', message: 'invalid iid format, expected "<id>@<server>"' }, frame.id);
            return;
        }
        const numId = parseInt(match[1], 10);
        const instance = await this.prisma.instances.findUnique({ where: { id: numId } });
        if (!instance) {
            this.sendFrame(ws, 'error', { code: 'NOT_FOUND', message: `Instance ${numId} not found` }, frame.id);
            return;
        }
        const iid = raw.trim();
        const at = Date.now();

        data.instance = { iid, at };

        const locations = this.getLocationsForUser(userId);
        this.sendFrame(ws, 'location_set', { locations }, frame.id);
        await this._emitPresenceEvent(userId);
        this.logger.debug(`User "${data.user.username}" set location: ${iid}`);
    }

    /** Broadcast a `user:presence` event to all sockets subscribed to `user:presence`. */
    private async _emitPresenceEvent(userId: number): Promise<void> {
        const user = await this.users.findById(userId);
        if (!user) return;
        const domain = await this.users.wellKnown.address();
        const status = PRESENCE_TO_API[user.presence] ?? 'online';
        const visibility = PRESENCE_VISIBILITY[status] ?? PRESENCE_VISIBILITY['online'];
        // Only include location in the broadcast if everyone can see it (e.g. stream).
        // For all other statuses the REST API applies per-viewer filtering.
        const broadcastLocations = visibility.visible_everyone
            ? this.getLocationsForUser(userId)
            : null;
        this.eventsService.emit('user:presence', {
            user: `${userId}@${domain}`,
            status,
            text: user.presenceStatus ?? null,
            locations: broadcastLocations,
        });
    }

    private onLog(ws: WebSocket, data: WsClientData, frame: WsInboundFrame): void {
        if (data.mode !== 'relay' || !data.relayId) return;
        this.relayService.handleRelayLog(data.relayId, frame.payload ?? {});
    }

    private onSpecs(ws: WebSocket, data: WsClientData, frame: WsInboundFrame): void {
        if (data.mode !== 'relay' || !data.relayId) return;
        if (frame.payload) this.relayService.handleRelaySpecs(data.relayId, frame.payload as any);
    }

    private onRequestInstances(ws: WebSocket, data: WsClientData, frame: WsInboundFrame): void {
        if (data.mode !== 'relay' || !data.relayId) return;
        this.logger.debug(`[Relay #${data.relayId}] Processing request_instances (id=${frame.id})`);
        const response = this.relayService.handleRequestInstances(data.relayId, frame.payload ?? {});
        void response
            .then((result) => {
                this.logger.debug(`[Relay #${data.relayId}] Sending response for request_instances (id=${frame.id})`);
                this.sendFrame(ws, 'response', result, frame.id);
            })
            .catch((err: unknown) => {
                this.logger.error(`[Relay #${data.relayId}] request_instances error: ${err}`);
                this.sendFrame(ws, 'response', { success: false, error: 'Internal server error' }, frame.id);
            });
    }

    private onResolveUser(ws: WebSocket, data: WsClientData, frame: WsInboundFrame): void {
        if (data.mode !== 'relay' || !data.relayId) return;
        const response = this.relayService.handleResolveUser(data.relayId, frame.payload ?? {});
        void response
            .then((result) => {
                this.sendFrame(ws, 'response', result, frame.id);
            })
            .catch((err: unknown) => {
                this.logger.error(`[Relay #${data.relayId}] resolve_user error: ${err}`);
                this.sendFrame(ws, 'response', { result: 'error', error: 'Internal server error' }, frame.id);
            });
    }

    private onSyncInstances(ws: WebSocket, data: WsClientData, frame: WsInboundFrame): void {
        if (data.mode !== 'relay' || !data.relayId) return;
        const response = this.relayService.handleSyncInstances(data.relayId, frame.payload ?? {});
        void response
            .then((result) => {
                this.logger.debug(`[Relay #${data.relayId}] Sending relay_sync_instances response: ${JSON.stringify(result)}`);
                this.sendFrame(ws, 'response', result, frame.id);
            })
            .catch((err: unknown) => {
                this.logger.error(`[Relay #${data.relayId}] relay_sync_instances error: ${err}`);
                this.sendFrame(ws, 'response', { success: false, error: 'Internal server error' }, frame.id);
            });
    }

    private onClientConnected(ws: WebSocket, data: WsClientData, frame: WsInboundFrame): void {
        if (data.mode !== 'relay' || !data.relayId) return;
        this.relayService.handleClientConnected(data.relayId, frame.payload ?? {});
    }

    private onClientDisconnected(ws: WebSocket, data: WsClientData, frame: WsInboundFrame): void {
        if (data.mode !== 'relay' || !data.relayId) return;
        this.relayService.handleClientDisconnected(data.relayId, frame.payload ?? {});
    }

    private onClientAuthentified(ws: WebSocket, data: WsClientData, frame: WsInboundFrame): void {
        if (data.mode !== 'relay' || !data.relayId) return;
        this.relayService.handleClientAuthentified(data.relayId, frame.payload ?? {});
    }

    private onPlayerJoin(ws: WebSocket, data: WsClientData, frame: WsInboundFrame): void {
        if (data.mode !== 'relay' || !data.relayId) return;
        this.relayService.handlePlayerJoin(data.relayId, frame.payload ?? {});
    }

    private onPlayerLeave(ws: WebSocket, data: WsClientData, frame: WsInboundFrame): void {
        if (data.mode !== 'relay' || !data.relayId) return;
        this.relayService.handlePlayerLeave(data.relayId, frame.payload ?? {});
    }

    private onInstanceSettingsChanged(ws: WebSocket, data: WsClientData, frame: WsInboundFrame): void {
        if (data.mode !== 'relay' || !data.relayId) return;
        this.relayService.handleInstanceSettingsChanged(data.relayId, frame.payload ?? {});
    }

    /** Handle logs response from relay (resolves pending request). */
    private onLogsResponse(ws: WebSocket, data: WsClientData, frame: WsInboundFrame): void {
        if (!frame.id) return;
        const pending = this.pendingRequests.get(frame.id);
        if (!pending) return;

        clearTimeout(pending.timeout);
        this.pendingRequests.delete(frame.id);
        pending.resolve(frame.payload);
    }

    private onStatusResponse(ws: WebSocket, data: WsClientData, frame: WsInboundFrame): void {
        if (!frame.id) return;
        const pending = this.pendingRequests.get(frame.id);
        if (!pending) return;

        clearTimeout(pending.timeout);
        this.pendingRequests.delete(frame.id);
        pending.resolve(frame.payload);
    }

    private onInstancesResponse(ws: WebSocket, data: WsClientData, frame: WsInboundFrame): void {
        if (!frame.id) return;
        const pending = this.pendingRequests.get(frame.id);
        if (!pending) return;

        clearTimeout(pending.timeout);
        this.pendingRequests.delete(frame.id);
        pending.resolve(frame.payload);
    }

    private onClientsResponse(ws: WebSocket, data: WsClientData, frame: WsInboundFrame): void {
        if (!frame.id) return;
        const pending = this.pendingRequests.get(frame.id);
        if (!pending) return;

        clearTimeout(pending.timeout);
        this.pendingRequests.delete(frame.id);
        pending.resolve(frame.payload);
    }

    private onPlayersResponse(ws: WebSocket, data: WsClientData, frame: WsInboundFrame): void {
        if (!frame.id) return;
        const pending = this.pendingRequests.get(frame.id);
        if (!pending) return;

        clearTimeout(pending.timeout);
        this.pendingRequests.delete(frame.id);
        pending.resolve(frame.payload);
    }

    // ── Public API (used by WsService) ─────────────────────────────────────

    /**
     * Emit a named event to all subscribed clients.
     * Frame sent: { type: "event", payload: { name, data } }
     */
    emit<T = unknown>(name: string, eventData: T): void {
        const set = this.rooms.get(name);
        if (!set || set.size === 0) return;
        const frame = JSON.stringify({ type: 'event', payload: { name, data: eventData } });
        for (const ws of set) {
            if (ws.readyState === WebSocket.OPEN) ws.send(frame);
        }
    }

    /** Emit a named event to all sockets belonging to a specific user. */
    emitToUser<T = unknown>(userId: number, name: string, eventData: T): void {
        const sockets = this.userSockets.get(userId);
        if (!sockets || sockets.size === 0) return;
        const frame = JSON.stringify({ type: 'event', payload: { name, data: eventData } });
        for (const ws of sockets) {
            if (ws.readyState === WebSocket.OPEN) ws.send(frame);
        }
    }

    /** Broadcast a raw frame to every connected client. */
    broadcast<T = unknown>(type: string, payload: T): void {
        const frame = JSON.stringify({ type, payload });
        this.wss?.clients.forEach((ws) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(frame);
        });
    }

    /** Register an access validator for a room (called by other modules). */
    registerValidator(name: string, fn: WsRoomValidator): void {
        this.validators.set(name, fn);
    }

    // ── Relay requests ─────────────────────────────────────────────────────

    /**
     * Send a request to a relay and wait for response with timeout.
     * Returns null if relay is not connected or request times out.
     */
    private async requestFromRelay<T>(
        relayId: number,
        type: string,
        data: unknown,
        timeoutMs = 10000,
    ): Promise<T | null> {
        const sockets = this.relayService.getSocketsForRelay(relayId);
        if (sockets.length === 0) return null;

        const socketId = sockets[0];
        const ws = Array.from(this.wss.clients).find(
            (client) => this.clients.get(client)?.socketId === socketId,
        );
        if (!ws || ws.readyState !== WebSocket.OPEN) return null;

        const correlationId = `${type}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        return new Promise<T | null>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(correlationId);
                this.logger.warn(`Request ${type} to relay #${relayId} timed out after ${timeoutMs}ms`);
                resolve(null);
            }, timeoutMs);

            this.pendingRequests.set(correlationId, { resolve, reject, timeout });
            this.sendFrame(ws, type, data, correlationId);
        });
    }

    /**
     * Push a server-initiated frame to all sockets of a relay.
     * Returns true if the relay is connected.
     */
    pushToRelay(relayId: number, type: string, payload: unknown): boolean {
        const sockets = this.relayService.getSocketsForRelay(relayId);
        if (sockets.length === 0) return false;
        for (const socketId of sockets) {
            const ws = Array.from(this.wss.clients).find(
                (client) => this.clients.get(client)?.socketId === socketId,
            );
            if (ws && ws.readyState === WebSocket.OPEN) {
                this.sendFrame(ws, type, payload);
            }
        }
        return true;
    }

    /**
     * Send a command to a relay.
     * Returns true if the relay is connected and the command was sent.
     */
    sendCommand(relayId: number, content: string): boolean {
        const sockets = this.relayService.getSocketsForRelay(relayId);
        if (sockets.length === 0) return false;

        for (const socketId of sockets) {
            const ws = Array.from(this.wss.clients).find(
                (client) => this.clients.get(client)?.socketId === socketId,
            );
            if (ws && ws.readyState === WebSocket.OPEN) {
                this.sendFrame(ws, 'command', { content });
            }
        }
        return true;
    }

    /**
     * Request logs from a relay.
     * Returns null if relay is not connected or does not respond.
     */
    async requestLogs(
        relayId: number,
        since?: number,
        limit = 100,
    ): Promise<Array<{ time: number; level: string; target: string; message: string }> | null> {
        const response = await this.requestFromRelay<{ logs: any[] }>(
            relayId,
            'logs',
            { since: since ?? 0, limit },
            10000,
        );

        if (!response || !Array.isArray(response.logs)) return null;
        return response.logs;
    }

    /**
     * Request status from a relay.
     * Returns null if relay is not connected or does not respond.
     */
    async requestStatus(
        relayId: number,
        timeoutMs = 10000,
    ): Promise<WsRelayStatus | null> {
        const response = await this.requestFromRelay<WsRelayStatus>(
            relayId,
            'status',
            {},
            timeoutMs,
        );
        return response;
    }

    /**
     * Request instances from a relay.
     * Returns null if relay is not connected or does not respond.
     */
    async requestInstances(
        relayId: number,
        limit = 100,
        offset = 0,
    ): Promise<{ total: number; instances: any[] } | null> {
        const response = await this.requestFromRelay<any>(
            relayId,
            'get_instances',
            { limit, offset },
            10000,
        );
        return response;
    }

    /**
     * Request clients from a relay.
     * Returns null if relay is not connected or does not respond.
     */
    async requestClients(
        relayId: number,
        limit = 100,
        offset = 0,
    ): Promise<{ total: number; clients: any[] } | null> {
        const response = await this.requestFromRelay<any>(
            relayId,
            'get_clients',
            { limit, offset },
            10000,
        );
        return response;
    }

    /**
     * Request players for a specific instance from a relay.
     * @param instanceId  The internal (DB) instance ID — matches relay's `n` field.
     * @param all         When true, include players with the HIDE_IN_LIST flag.
     * Returns null if relay is not connected or does not respond.
     */
    async requestPlayers(
        relayId: number,
        instanceId: number,
        limit = 20,
        offset = 0,
        all = false,
    ): Promise<{ t: number; i: RelayPlayer[] } | null> {
        return this.requestFromRelay<{ t: number; i: RelayPlayer[] }>(
            relayId,
            'get_players',
            { i: instanceId, l: limit, o: offset, a: all },
            10000,
        );
    }

    /**
     * Returns the deduplicated list of instance iids the user is currently in,
     * derived from their open WebSocket connections.
     * Sorted most-recent join first.
     */
    getLocationsForUser(userId: number): string[] {
        const sockets = this.userSockets.get(userId);
        if (!sockets || sockets.size === 0) return [];
        const seen = new Map<string, number>(); // iid → at
        for (const ws of sockets) {
            const d = this.clients.get(ws);
            if (d?.instance) {
                const { iid, at } = d.instance;
                const prev = seen.get(iid);
                if (prev === undefined || prev < at) seen.set(iid, at);
            }
        }
        return Array.from(seen.entries())
            .sort((a, b) => b[1] - a[1])
            .map(e => e[0]);
    }

    // ── Internal ──────────────────────────────────────────────────────────

    private sendFrame(ws: WebSocket, type: string, payload: unknown, id?: string): void {
        if (ws.readyState === WebSocket.OPEN) {
            const frame: any = { type, payload };
            if (id) frame.id = id;
            ws.send(JSON.stringify(frame));
        }
    }
}
