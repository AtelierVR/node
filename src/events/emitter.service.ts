import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { DomainEventName, DomainEvents } from './domain-events';

/**
 * In-process domain events — **not** WebSocket.
 *
 * This is the only channel services use to talk to each other. Nothing here reaches a client: a
 * service that wants a browser to see something asks the WebSocket layer explicitly (see
 * `WsService`), so internal and client-facing concerns cannot be confused.
 *
 * `EventEmitter2` on its own takes `(name: string, payload?: any)`: every payload unchecked, every
 * name a free string. Going through this service ties both to {@link DomainEvents}, making a bogus
 * name or a missing field a compile error.
 *
 * Subscribing is declarative: `@OnEvent(Events.X)` on the consumer, never a runtime `on()`.
 */
@Injectable()
export class EmitterService {
  constructor(private readonly bus: EventEmitter2) {}

  /** Publish a domain event. Listeners run synchronously, in registration order. */
  emit<K extends DomainEventName>(name: K, payload: DomainEvents[K]): void {
    this.bus.emit(name, payload);
  }
}
