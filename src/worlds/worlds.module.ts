import { Module, forwardRef } from '@nestjs/common';
import { WorldsService } from './worlds.service';
import { WorldsController } from './worlds.controller';
import { FediverseModule } from '../fediverse/fediverse.module';
import { StorageModule } from '../storage/storage.module';
import { AuthModule } from '../auth/auth.module';
import { ExternalServersModule } from '../external/external-servers.module';
import { ActivityModule } from '../activity/activity.module';

@Module({
    imports: [forwardRef(() => FediverseModule), StorageModule, AuthModule, ExternalServersModule, ActivityModule],
    controllers: [WorldsController],
    providers: [WorldsService],
    exports: [WorldsService],
})
export class WorldsModule { }
