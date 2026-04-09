import { Module } from '@nestjs/common';
import { ExternalServersService } from './external-servers.service';
import { FediverseModule } from 'src/fediverse/fediverse.module';

@Module({
    imports: [FediverseModule],
    providers: [ExternalServersService],
    exports: [ExternalServersService],
})
export class ExternalServersModule {}
