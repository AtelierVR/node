import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { WEBSOCKET_FRAME_GUARD_METADATA } from './websocket-event.decorator';

/** May this socket subscribe to the frame? */
export type WebsocketFrameGuard = (
  socket: unknown,
) => Promise<boolean> | boolean;

/**
 * Collects the `@OnWebsocketEventRegister(frame)` methods and answers access questions about them.
 *
 * Lives in the (global) events module rather than in `WsService` on purpose: the Socket.IO gateway
 * needs it too, and making it depend on `WsService` would close a cycle
 * (`EventsGateway → WsService → EventsService → EventsGateway`).
 *
 * A frame with no declared guard is open — it was never meant to be private — and the registry
 * logs what it found at boot, so an un-guarded privileged frame is visible instead of silent.
 */
@Injectable()
export class WebsocketGuardRegistry implements OnApplicationBootstrap {
  private readonly logger = new Logger(WebsocketGuardRegistry.name);

  private readonly guards = new Map<string, WebsocketFrameGuard>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly reflector: Reflector,
  ) {}

  onApplicationBootstrap() {
    const scanner = new MetadataScanner();
    for (const wrapper of this.discovery.getProviders()) {
      const instance = wrapper.instance as
        | Record<string, unknown>
        | null
        | undefined;
      if (!instance) continue;

      for (const method of scanner.getAllMethodNames(
        Object.getPrototypeOf(instance) as object,
      )) {
        const handler = instance[method];
        if (typeof handler !== 'function') continue;

        // One method may guard several frames: the decorator accumulates them.
        const frames = this.reflector.get<string[]>(
          WEBSOCKET_FRAME_GUARD_METADATA,
          handler,
        );
        if (!frames?.length) continue;

        const guard = handler as WebsocketFrameGuard;
        for (const frame of frames)
          this.guards.set(frame, guard.bind(instance));
      }
    }
    this.logger.log(
      `WebSocket frame guards: ${[...this.guards.keys()].sort().join(', ') || 'none'}`,
    );
  }

  /** True when no guard was declared for the frame (see the class docs). */
  canSubscribe(frame: string, socket: unknown): Promise<boolean> | boolean {
    const guard = this.guards.get(frame);
    if (!guard) return true;
    return guard(socket);
  }
}
