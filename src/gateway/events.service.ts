import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import LoggerStore from '../utils/logger';
import { OnWebsocketEventRegister } from '../events/websocket-event.decorator';
import { WsFrames } from '../events/websocket-frames';
import type {
  WebsocketFrame,
  WebsocketFrames,
} from '../events/websocket-frames';
import type { Socket } from 'socket.io';

/**
 * Client-facing frames over **Socket.IO**.
 *
 * This is the Socket.IO transport only. It knows nothing about the in-process bus
 * (`EmitterService`), and services do not publish here directly: they go through `WsService.emit`,
 * which fans out to both transports and types the payload against `WebsocketFrames`.
 *
 * It stays a provider because the two gateways are distinct sockets — a client may be connected to
 * either one, or to both.
 */
@Injectable()
export class EventsService implements OnModuleInit {
  constructor(private readonly gateway: EventsGateway) {}

  @OnWebsocketEventRegister(WsFrames.SERVER_LOGS)
  @OnWebsocketEventRegister(WsFrames.ACTIVITY)
  private _register(socket: Socket): Promise<boolean> {
    return Promise.resolve(!!socket.data?.user?.isAdmin?.());
  }

  onModuleInit() {
    // Register callback to broadcast server logs in real-time
    LoggerStore.onLogPush((entry) => {
      this.emit(WsFrames.SERVER_LOGS, {
        timestamp: entry.timestamp.getTime(),
        level: entry.level,
        message: entry.message,
        tag: entry.tag,
      });
    });
  }

  /** Emit a frame to all Socket.IO sockets subscribed to its room. */
  emit<TFrame extends WebsocketFrame>(
    name: TFrame,
    data: WebsocketFrames[TFrame],
  ): void {
    this.gateway.emit(name, data);
  }

  /** Emit a frame to every Socket.IO socket of one user. */
  emitToUser<TFrame extends WebsocketFrame>(
    userId: number,
    name: TFrame,
    data: WebsocketFrames[TFrame],
  ): void {
    this.gateway.emitToUser(userId, name, data);
  }
}
