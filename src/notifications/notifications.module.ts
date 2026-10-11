import { Module, forwardRef } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { UsersModule } from '../users/users.module';
import { ExternalServersModule } from '../external/external-servers.module';
import { FediverseModule } from '../fediverse/fediverse.module';
import { WsModule } from '../ws/ws.module';
import { PrismaModule } from '../database/prisma.module';
import { TunnelModule } from '../tunnel/tunnel.module';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => ExternalServersModule),
    forwardRef(() => FediverseModule),
    forwardRef(() => WsModule),
    forwardRef(() => UsersModule),
    forwardRef(() => TunnelModule),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}