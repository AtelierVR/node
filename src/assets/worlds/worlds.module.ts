import { Module } from '@nestjs/common';
import { AssetsModule } from '@/assets/assets.module';
import { WorldsController } from '@/assets/worlds/worlds.controller';
import { WorldsProvider } from '@/assets/worlds/worlds.provider';
import { AuthModule } from '@/auth/auth.module';
import { FediverseModule } from '@/fediverse/fediverse.module';
import { JobQueueModule } from '@/jobs/job-queue.module';
import { StorageModule } from '@/storage/storage.module';

/**
 * Assets-based world feature.
 *
 * Mirrors {@link ModsModule}: it registers the `WorldsController` and its
 * locally-hosted `WorldsProvider` (a `UploadProvider` adding the `capacity`
 * option) on top of the generic {@link AssetsModule}.
 */
@Module({
    imports: [
        AssetsModule.register({
            controllers: [
                WorldsController
            ],
            providers: [
                WorldsProvider
            ],
            imports: [
                FediverseModule, 
                StorageModule, 
                AuthModule, 
                JobQueueModule
            ],
        }),
    ],
})
export class WorldsModule {}
