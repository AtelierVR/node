import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import type { Socket } from 'socket.io';
import { WsGateway } from 'src/ws/ws.gateway';
import LoggerStore from '../utils/logger';

@Injectable()
export class EventsService implements OnModuleInit {

    private wsGateway: WsGateway | null = null;

    constructor(private readonly gateway: EventsGateway) { }

    onModuleInit() {
        // Register callback to broadcast server logs in real-time
        LoggerStore.onLogPush((entry) => {
            this.emit('server_logs', {
                timestamp: entry.timestamp.getTime(),
                level: entry.level,
                message: entry.message,
                tag: entry.tag,
            });
        });
    }

    /** Register WebSocket gateway for native WebSocket broadcasting */
    registerWsGateway(wsGateway: any) {
        this.wsGateway = wsGateway;
    }

    /** Emit an event to all sockets subscribed to the given room. */
    emit<T = unknown>(name: string, data: T) {
        // Broadcast via Socket.IO
        this.gateway.emit(name, data);
        
        // Also broadcast via native WebSocket if available
        if (this.wsGateway && typeof this.wsGateway.emit === 'function') 
            this.wsGateway.emit(name, data);
    }

    /** Emit an event to a specific user's connected sockets. */
    emitToUser<T = unknown>(userId: number, name: string, data: T) {
        this.gateway.emitToUser(userId, name, data);
        if (this.wsGateway && typeof this.wsGateway.emitToUser === 'function')
            this.wsGateway.emitToUser(userId, name, data);
    }

    /** Register a validator for a named event. */
    registerValidator(name: string, fn: (socket: Socket) => Promise<boolean>) {
        this.gateway.registerValidator(name, fn);
    }
}
