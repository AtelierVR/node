import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { PrismaModule } from './database/prisma.module';
import { AppConfigModule } from './config/config.module';
import { FediverseModule } from './fediverse/fediverse.module';
import { UsersModule } from './users/users.module';
import { ServerModule } from './server/server.module';
import { StorageModule } from './storage/storage.module';
import { ExternalServersModule } from './external/external-servers.module';
import { ApiInterceptor } from './api/api.interceptor';
import { RelationsModule } from './relations/relations.module';
import { WorldsModule } from './worlds/worlds.module';
import { TablesModule } from './tables/tables.module';
import { AvatarsModule } from './avatars/avatars.module';
import { ActivityModule } from './activity/activity.module';
import { GatewayModule } from './gateway/gateway.module';
import { InstancesModule } from './instances/instances.module';
import { RelayModule } from './relay/relay.module';
import { WsModule } from './ws/ws.module';
import { JobQueueModule } from './jobs/job-queue.module';
import { CacheModule } from './cache/cache.module';
import { SearchModule } from './search/search.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    PrismaModule,
    FediverseModule,
    AppConfigModule,
    StorageModule,
    UsersModule,
    ServerModule,
    ExternalServersModule,
    RelationsModule,
    WorldsModule,
    TablesModule,
    AvatarsModule,
    ActivityModule,
    GatewayModule,
    InstancesModule,
    RelayModule,
    WsModule,
    JobQueueModule,
    CacheModule,
    SearchModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: ApiInterceptor },
  ],
  exports: [],
})
export class AppModule { }
