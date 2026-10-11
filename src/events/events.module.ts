import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { EmitterService } from './emitter.service';
import { WebsocketGuardRegistry } from './websocket-guard.service';

/**
 * Event infrastructure.
 *
 * Global on purpose: almost every feature module publishes or listens, and importing this module
 * everywhere would add noise for no isolation benefit (the bus itself is already app-wide).
 * `EventEmitterModule.forRoot()` is registered in `AppModule`, which makes `EventEmitter2` global
 * too — that is what `@OnEvent` relies on.
 *
 * {@link WebsocketGuardRegistry} lives here rather than in `WsService` so both gateways can ask it
 * without depending on the service that fans out to them.
 */
@Global()
@Module({
  // `DiscoveryModule` is what lets the guard registry find every `@OnWebsocketEventRegister`
  // method across the app; `EventEmitterModule.forRoot()` is registered in `AppModule`.
  imports: [DiscoveryModule],
  providers: [EmitterService, WebsocketGuardRegistry],
  exports: [EmitterService, WebsocketGuardRegistry],
})
export class EventsModule {}
