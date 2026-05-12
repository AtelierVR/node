import { Module, forwardRef } from '@nestjs/common';
import { InstancesService } from './instances.service';
import { InstancesController } from './instances.controller';
import { FediverseModule } from '../fediverse/fediverse.module';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { WsModule } from '../ws/ws.module';

@Module({
    imports: [FediverseModule, AuthModule, StorageModule, forwardRef(() => WsModule)],
    controllers: [InstancesController],
    providers: [InstancesService],
    exports: [InstancesService],
})
export class InstancesModule { }
