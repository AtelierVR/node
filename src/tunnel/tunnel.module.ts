import { Module, forwardRef } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { TunnelService } from './tunnel.service';
import { TunnelController } from './tunnel.controller';
import { ExternalServersModule } from '../external/external-servers.module';
import { FediverseModule } from '../fediverse/fediverse.module';
import { OptionalServerGuard, ServerGuard } from '../auth/server.guard';

/**
 * Server-to-server request/response over the standard tunnel.
 *
 * Owns `TunnelService` (`send` / `@OnTunnel` registry) and the `/tunnel` endpoint.
 * `TunnelService` is exported so feature modules (relations, notifications, …) can
 * inject it as `this.tunnel`.
 */
@Module({
  imports: [
    ExternalServersModule,
    forwardRef(() => FediverseModule),
    DiscoveryModule,
  ],
  controllers: [TunnelController],
  providers: [TunnelService, OptionalServerGuard, ServerGuard],
  exports: [TunnelService],
})
export class TunnelModule {}
