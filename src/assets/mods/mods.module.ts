import { Module } from '@nestjs/common';
import { AssetsModule } from '@/assets/assets.module';
import { GithubProvider } from '@/assets/mods/providers/github/provider';
import { UploadProvider } from '@/assets/upload/provider';
import { ModsController } from '@/assets/mods/mods.controller';
import { AuthModule } from '@/auth/auth.module';
import { FediverseModule } from '@/fediverse/fediverse.module';
import { JobQueueModule } from '@/jobs/job-queue.module';
import { StorageModule } from '@/storage/storage.module';

@Module({
  imports: [
    AssetsModule.register({
      controllers: [
        ModsController
      ],
      providers: [
        UploadProvider, 
        GithubProvider
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
export class ModsModule {}
