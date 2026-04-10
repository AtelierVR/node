import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    MessageBody,
    ConnectedSocket,
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger, Inject, forwardRef } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { SessionService } from '../auth/session.service';
import { UsersService } from '../users/users.service';

@WebSocketGateway({ cors: { origin: '*' } })
export class EventsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {

    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(EventsGateway.name);
    private readonly validators = new Map<string, (socket: Socket) => Promise<boolean>>();

    constructor(
        private readonly sessions: SessionService,
        @Inject(forwardRef(() => UsersService))
        private readonly users: UsersService,
    ) {
        // Built-in validators — admin-only events
        this.validators.set('activity', (s) => this.requireAdmin(s));
        this.validators.set('server_logs', (s) => this.requireAdmin(s));
    }

    afterInit() {
        this.logger.log('WebSocket gateway initialized');
    }

    async handleConnection(socket: Socket) {
        const token = this.extractToken(socket);
        socket.data.user = null;
        socket.data.session = null;

        if (!token) return;

        const session = await this.sessions.findSessionByToken(token);
        if (!session || new Date(session.expires) < new Date()) return;

        const user = await this.users.findById(session.userId);
        if (!user) return;

        socket.data.user = user;
        socket.data.session = session;

        socket.emit('user_connected', {
            id: user.id,
            username: user.username,
            display: user.display,
        });

        this.logger.debug(`User "${user.username}" connected (${socket.id})`);
    }

    handleDisconnect(socket: Socket) {
        const user = socket.data?.user;
        if (user) this.logger.debug(`User "${user.username}" disconnected`);
    }

    @SubscribeMessage('ping')
    handlePing(@MessageBody() data: { time?: number }) {
        return { time: Date.now(), received: data?.time ?? 0 };
    }

    @SubscribeMessage('subscribe')
    async handleSubscribe(
        @MessageBody() data: { events: string[] },
        @ConnectedSocket() client: Socket,
    ) {
        if (!Array.isArray(data?.events))
            return { success: false, error: 'events must be an array' };

        const subscribed: string[] = [];
        const denied: string[] = [];

        for (const event of data.events) {
            if (typeof event !== 'string' || event.length === 0) continue;
            const validator = this.validators.get(event);
            if (validator && !(await validator(client))) {
                denied.push(event);
                continue;
            }
            await client.join(event);
            subscribed.push(event);
        }

        return { success: true, subscribed, ...(denied.length ? { denied } : {}) };
    }

    @SubscribeMessage('unsubscribe')
    async handleUnsubscribe(
        @MessageBody() data: { events: string[] },
        @ConnectedSocket() client: Socket,
    ) {
        if (!Array.isArray(data?.events))
            return { success: false, error: 'events must be an array' };

        const unsubscribed: string[] = [];
        for (const event of data.events) {
            if (typeof event !== 'string') continue;
            client.leave(event);
            unsubscribed.push(event);
        }

        return { success: true, unsubscribed };
    }

    /** Register a validator for a named event — called to check if the socket may subscribe. */
    registerValidator(name: string, fn: (socket: Socket) => Promise<boolean>) {
        this.validators.set(name, fn);
    }

    /** Emit an event to all sockets subscribed to the given room. */
    emit<T = unknown>(name: string, data: T) {
        if (!this.server) return;
        this.server.to(name).emit(`event:${name}`, data);
    }

    private extractToken(socket: Socket): string | null {
        // 1. socket.io auth object: { token: '...' }
        const auth = socket.handshake.auth?.token;
        if (auth && typeof auth === 'string') return auth;

        // 2. Authorization header  (Bearer <token>)
        const header = socket.handshake.headers.authorization;
        if (header) {
            if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
            return header;
        }

        // 3. ?auth= query param
        const query = socket.handshake.query.auth;
        if (query && typeof query === 'string') return query;

        // 4. _uid cookie (same as _node/)
        const cookie = socket.handshake.headers.cookie;
        if (cookie) {
            const match = cookie.match(/(?:^|;\s*)_uid=([^;]+)/);
            if (match) return decodeURIComponent(match[1]);
        }

        return null;
    }

    private async requireAdmin(socket: Socket): Promise<boolean> {
        return !!(socket.data?.user?.isAdmin?.());
    }
}
