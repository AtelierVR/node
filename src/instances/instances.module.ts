import { Module } from '@nestjs/common';
import { InstancesService } from './instances.service';
import { InstancesController } from './instances.controller';
import { FediverseModule } from '../fediverse/fediverse.module';
import { AuthModule } from '../auth/auth.module';

@Module({
    imports: [FediverseModule, AuthModule],
    controllers: [InstancesController],
    providers: [InstancesService],
    exports: [InstancesService],
})
export class InstancesModule { }
