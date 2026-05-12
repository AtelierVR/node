import { Module, forwardRef } from '@nestjs/common';
import { RelationsService } from './relations.service';
import { RelationsController } from './relations.controller';
import { FediverseModule } from '../fediverse/fediverse.module';
import { UsersModule } from '../users/users.module';
import { ExternalServersModule } from '../external/external-servers.module';
import { ExternalUsersModule } from '../external/external-users.module';
import { AuthModule } from '../auth/auth.module';
import { OptionalServerGuard, ServerGuard } from '../auth/server.guard';
import { AuthUserGuard, OptionalAuthUserGuard } from '../auth/auth.guard';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
    imports: [
        FediverseModule,
        forwardRef(() => UsersModule),
        ExternalServersModule,
        ExternalUsersModule,
        forwardRef(() => AuthModule),
        GatewayModule,
    ],
    controllers: [RelationsController],
    providers: [RelationsService, OptionalServerGuard, ServerGuard, AuthUserGuard, OptionalAuthUserGuard],
    exports: [RelationsService],
})
export class RelationsModule { }
