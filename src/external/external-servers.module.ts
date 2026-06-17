import { Module, forwardRef } from '@nestjs/common';
import { ExternalServersService } from './external-servers.service';
import { ServersController } from './servers.controller';
import { FediverseModule } from 'src/fediverse/fediverse.module';
import { CacheModule } from '../cache/cache.module';

@Module({
    imports: [
        forwardRef(() => FediverseModule),
        CacheModule
    ],
    controllers: [
        ServersController
    ],
    providers: [
        ExternalServersService
    ],
    exports: [
        ExternalServersService
    ],
})
export class ExternalServersModule { }
