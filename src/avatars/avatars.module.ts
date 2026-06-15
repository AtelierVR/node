import { Module, forwardRef } from '@nestjs/common';
import { AvatarsService } from './avatars.service';
import { AvatarsController } from './avatars.controller';
import { FediverseModule } from '../fediverse/fediverse.module';
import { StorageModule } from '../storage/storage.module';
import { AuthModule } from '../auth/auth.module';
import { ExternalServersModule } from '../external/external-servers.module';
import { ActivityModule } from '../activity/activity.module';

@Module({
    imports: [forwardRef(() => FediverseModule), StorageModule, AuthModule, ExternalServersModule, ActivityModule],
    controllers: [AvatarsController],
    providers: [AvatarsService],
    exports: [AvatarsService],
})
export class AvatarsModule { }
