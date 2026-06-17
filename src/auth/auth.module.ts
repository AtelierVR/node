import { Module, forwardRef } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { SessionService } from './session.service';
import { DeviceService } from './device.service';
import { VerificationService } from './verification.service';
import { UsersModule } from '../users/users.module';
import { AuthUserGuard, OptionalAuthUserGuard } from './auth.guard';
import { ServerGuard, OptionalServerGuard } from './server.guard';
import { ServerAsUserGuard, OptionalServerAsUserGuard } from './server-as-user.guard';
import { AuthOrServerAsUserGuard, OptionalAuthOrServerAsUserGuard } from './auth-or-server-as-user.guard';
import { ExternalServersModule } from '../external/external-servers.module';
import { ExternalUsersModule } from '../external/external-users.module';
import { FediverseModule } from '../fediverse/fediverse.module';
import { CacheModule } from '../cache/cache.module';

@Module({
    imports: [
        forwardRef(() => UsersModule),
        ExternalServersModule,
        ExternalUsersModule,
        forwardRef(() => FediverseModule),
        CacheModule
    ],
    controllers: [
        AuthController
    ],
    providers: [
        AuthService,
        SessionService,
        DeviceService,
        VerificationService,
        AuthUserGuard,
        OptionalAuthUserGuard,
        OptionalServerGuard,
        ServerGuard,
        OptionalServerAsUserGuard,
        ServerAsUserGuard,
        AuthOrServerAsUserGuard,
        OptionalAuthOrServerAsUserGuard,
    ],
    exports: [
        AuthService,
        VerificationService,
        AuthUserGuard,
        OptionalAuthUserGuard,
        ServerGuard,
        OptionalServerGuard,
        OptionalServerAsUserGuard,
        ServerAsUserGuard,
        AuthOrServerAsUserGuard,
        OptionalAuthOrServerAsUserGuard,
    ],
})
export class AuthModule { }
