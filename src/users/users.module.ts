import { Module, forwardRef } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { FediverseModule } from '../fediverse/fediverse.module';
import { SessionService } from '../auth/session.service';
import { AuthUserGuard, OptionalAuthUserGuard } from '../auth/auth.guard';
import { AdminUserGuard } from '../auth/admin-user.guard';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';
import { StorageModule } from '../storage/storage.module';
import { RelationsModule } from '../relations/relations.module';
import { ExternalServersModule } from '../external/external-servers.module';
import { ExternalUsersModule } from '../external/external-users.module';
import { OptionalServerGuard, ServerGuard } from '../auth/server.guard';
import { OptionalServerAsUserGuard, ServerAsUserGuard } from '../auth/server-as-user.guard';
import { ActivityModule } from '../activity/activity.module';
import { WsModule } from '../ws/ws.module';
import { CacheModule } from '../cache/cache.module';

@Module({
  imports: [
    forwardRef(() => FediverseModule),
    forwardRef(() => AuthModule),
    forwardRef(() => EmailModule),
    StorageModule,
    forwardRef(() => RelationsModule),
    ExternalServersModule,
    ExternalUsersModule,
    forwardRef(() => ActivityModule),
    forwardRef(() => WsModule),
    CacheModule,
  ],
  controllers: [UsersController],
  providers: [
    UsersService,
    SessionService,
    AuthUserGuard,
    OptionalAuthUserGuard,
    AdminUserGuard,
    OptionalServerGuard,
    ServerGuard,
    OptionalServerAsUserGuard,
    ServerAsUserGuard
  ],
  exports: [
    UsersService,
    SessionService,
    AuthUserGuard,
    OptionalAuthUserGuard,
    AdminUserGuard
  ]
})
export class UsersModule { }
