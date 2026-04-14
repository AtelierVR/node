import { Module } from '@nestjs/common';
import { ExternalServersService } from './external-servers.service';
import { ServersController } from './servers.controller';
import { FediverseModule } from 'src/fediverse/fediverse.module';

@Module({
    imports: [FediverseModule],
    controllers: [ServersController],
    providers: [ExternalServersService],
    exports: [ExternalServersService],
})
export class ExternalServersModule {}
