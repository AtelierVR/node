import { Module } from '@nestjs/common';
import { AssetsModule } from '@/assets/assets.module';
import { UploadProvider } from '@/assets/upload/provider';
import { AvatarsController } from '@/assets/avatars/avatars.controller';
import { AuthModule } from '@/auth/auth.module';
import { FediverseModule } from '@/fediverse/fediverse.module';
import { JobQueueModule } from '@/jobs/job-queue.module';
import { StorageModule } from '@/storage/storage.module';

/**
 * Assets-based avatar feature.
 *
 * Mirrors {@link ModsModule}: avatars have no type-specific option, so the
 * generic locally-hosted {@link UploadProvider} is used unchanged.
 */
@Module({
  imports: [
    AssetsModule.register({
      controllers: [
        AvatarsController
      ],
      providers: [
        UploadProvider
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
export class AvatarsModule {}
