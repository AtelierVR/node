import { Injectable } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import type { Socket } from 'socket.io';

@Injectable()
export class EventsService {

    constructor(private readonly gateway: EventsGateway) { }

    /** Emit an event to all sockets subscribed to the given room. */
    emit<T = unknown>(name: string, data: T) {
        this.gateway.emit(name, data);
    }

    /** Register a validator for a named event. */
    registerValidator(name: string, fn: (socket: Socket) => Promise<boolean>) {
        this.gateway.registerValidator(name, fn);
    }
}
