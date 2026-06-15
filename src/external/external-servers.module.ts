import { Module, forwardRef } from '@nestjs/common';
import { ExternalServersService } from './external-servers.service';
import { ServersController } from './servers.controller';
import { FediverseModule } from 'src/fediverse/fediverse.module';

@Module({
    imports: [forwardRef(() => FediverseModule)],
    controllers: [ServersController],
    providers: [ExternalServersService],
    exports: [ExternalServersService],
})
export class ExternalServersModule {}
