import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    MessageBody,
    ConnectedSocket,
    OnGatewayConnection,
    OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Server, Socket } from 'socket.io';
import { RelayService } from './relay.service';
import {
    RelayLogsResponseDto,
    RelayInstancesResponseDto,
    RelayClientsResponseDto,
} from './dto/relay-response.dto';
import type { NormalizedLogEntry, NormalizedRelayInstance, NormalizedRelayClient } from './dto/relay-response.dto';

/**
 * Dedicated Socket.io gateway for relay processes.
 * Relays authenticate by sending their token in the handshake auth or Bearer header.
 * Namespace: /relay
 */
@WebSocketGateway({ namespace: '/relay', cors: { origin: '*' } })
export class RelayGateway implements OnGatewayConnection, OnGatewayDisconnect {

    @WebSocketServer()
    server!: Server;

    private readonly logger = new Logger(RelayGateway.name);

    constructor(private readonly relayService: RelayService) { }

    async handleConnection(socket: Socket) {
        const token = this.extractToken(socket);
        if (!token) {
            this.logger.warn(`Relay connection rejected: no token (${socket.id})`);
            socket.disconnect(true);
            return;
        }

        const relay = await this.relayService.findByToken(token);
        if (!relay) {
            this.logger.warn(`Relay connection rejected: unknown token (${socket.id})`);
            socket.disconnect(true);
            return;
        }

        socket.data.relayId = relay.id;
        this.relayService.registerSocket(socket.id, relay.id);
        this.relayService.handleRelayConnected(relay.id);
    }

    handleDisconnect(socket: Socket) {
        const relayId: number | undefined = socket.data?.relayId;
        if (relayId !== undefined) {
            this.relayService.unregisterSocket(socket.id);
            this.relayService.handleRelayDisconnected(relayId);
        }
    }

    // ── Relay → Node messages ─────────────────────────────────────────────────────

    @SubscribeMessage('request_instances')
    async onRequestInstances(@ConnectedSocket() socket: Socket, @MessageBody() data: any) {
        const relayId: number = socket.data?.relayId;
        if (!relayId) return { success: false, error: 'not authenticated' };
        return this.relayService.handleRequestInstances(relayId, data ?? {});
    }

    @SubscribeMessage('resolve_user')
    async onResolveUser(@ConnectedSocket() socket: Socket, @MessageBody() data: any) {
        const relayId: number = socket.data?.relayId;
        if (!relayId) return { result: 'error', error: 'not authenticated' };
        return this.relayService.handleResolveUser(relayId, data ?? {});
    }

    @SubscribeMessage('relay_sync_instances')
    async onSyncInstances(@ConnectedSocket() socket: Socket, @MessageBody() data: any) {
        const relayId: number = socket.data?.relayId;
        if (!relayId) return { success: false, error: 'not authenticated' };
        return this.relayService.handleSyncInstances(relayId, data ?? {});
    }

    @SubscribeMessage('log')
    onLog(@ConnectedSocket() socket: Socket, @MessageBody() data: any) {
        const relayId: number = socket.data?.relayId;
        if (relayId) this.relayService.handleRelayLog(relayId, data ?? {});
    }

    @SubscribeMessage('specs')
    onSpecs(@ConnectedSocket() socket: Socket, @MessageBody() data: any) {
        const relayId: number = socket.data?.relayId;
        if (relayId) this.relayService.handleRelaySpecs(relayId, data ?? {});
    }

    @SubscribeMessage('client_connected')
    onClientConnected(@ConnectedSocket() socket: Socket, @MessageBody() data: any) {
        const relayId: number = socket.data?.relayId;
        if (relayId) this.relayService.handleClientConnected(relayId, data ?? {});
    }

    @SubscribeMessage('client_disconnected')
    onClientDisconnected(@ConnectedSocket() socket: Socket, @MessageBody() data: any) {
        const relayId: number = socket.data?.relayId;
        if (relayId) this.relayService.handleClientDisconnected(relayId, data ?? {});
    }

    @SubscribeMessage('player_join')
    onPlayerJoin(@ConnectedSocket() socket: Socket, @MessageBody() data: any) {
        const relayId: number = socket.data?.relayId;
        if (relayId) this.relayService.handlePlayerJoin(relayId, data ?? {});
    }

    @SubscribeMessage('player_leave')
    onPlayerLeave(@ConnectedSocket() socket: Socket, @MessageBody() data: any) {
        const relayId: number = socket.data?.relayId;
        if (relayId) this.relayService.handlePlayerLeave(relayId, data ?? {});
    }

    // ── Node → Relay commands ─────────────────────────────────────────────────────

    /** Send a command string to a specific relay. */
    sendCommand(relayId: number, command: string): boolean {
        const sockets = this.relayService.getSocketsForRelay(relayId);
        if (sockets.length === 0) return false;
        for (const sid of sockets) this.server.to(sid).emit('command', { content: command });
        return true;
    }

    /** Ask a relay for its status and await the response. */
    async requestStatus(relayId: number, timeoutMs = 5000): Promise<any | null> {
        const sockets = this.relayService.getSocketsForRelay(relayId);
        if (sockets.length === 0) return null;
        const sid = sockets[0];
        return new Promise((resolve) => {
            const timer = setTimeout(() => resolve(null), timeoutMs);
            this.server.timeout(timeoutMs).to(sid).emitWithAck('status', {})
                .then((res: any) => { clearTimeout(timer); resolve(res); })
                .catch(() => { clearTimeout(timer); resolve(null); });
        });
    }

    /** Ask a relay for its logs. */
    async requestLogs(relayId: number, since?: number, limit = 100): Promise<NormalizedLogEntry[] | null> {
        const sockets = this.relayService.getSocketsForRelay(relayId);
        if (sockets.length === 0) return null;
        const sid = sockets[0];
        try {
            const res = await this.server.timeout(10000).to(sid).emitWithAck('logs', { since, limit });
            const dto = plainToInstance(RelayLogsResponseDto, res ?? {});
            const errors = validateSync(dto);
            if (errors.length > 0) {
                this.logger.warn(`Relay #${relayId} returned invalid logs response`);
                return null;
            }
            return dto.logs.map(l => l.normalize());
        } catch {
            return null;
        }
    }

    /** Ask a relay for its instances. */
    async requestInstances(relayId: number, limit = 100, offset = 0): Promise<{ total: number; instances: import('./dto/relay-response.dto').RelayInstanceItemDto[] } | null> {
        const sockets = this.relayService.getSocketsForRelay(relayId);
        if (sockets.length === 0) return null;
        const sid = sockets[0];
        try {
            const res = await this.server.timeout(10000).to(sid).emitWithAck('get_instances', { limit, offset });
            const dto = plainToInstance(RelayInstancesResponseDto, res ?? {});
            const errors = validateSync(dto);
            if (errors.length > 0) {
                this.logger.warn(`Relay #${relayId} returned invalid instances response`);
                return null;
            }
            return { total: dto.total, instances: dto.instances };
        } catch {
            return null;
        }
    }

    /** Ask a relay for its clients. */
    async requestClients(relayId: number, limit = 100, offset = 0): Promise<{ total: number; clients: import('./dto/relay-response.dto').RelayClientItemDto[] } | null> {
        const sockets = this.relayService.getSocketsForRelay(relayId);
        if (sockets.length === 0) return null;
        const sid = sockets[0];
        try {
            const res = await this.server.timeout(10000).to(sid).emitWithAck('get_clients', { limit, offset });
            const dto = plainToInstance(RelayClientsResponseDto, res ?? {});
            const errors = validateSync(dto);
            if (errors.length > 0) {
                this.logger.warn(`Relay #${relayId} returned invalid clients response`);
                return null;
            }
            return { total: dto.total, clients: dto.clients };
        } catch {
            return null;
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────────

    private extractToken(socket: Socket): string | null {
        const auth = socket.handshake.auth?.token;
        if (auth && typeof auth === 'string') return auth;

        const header = socket.handshake.headers.authorization;
        if (header) {
            if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
            return header;
        }

        const query = socket.handshake.query.token;
        if (query && typeof query === 'string') return query;

        return null;
    }
}
