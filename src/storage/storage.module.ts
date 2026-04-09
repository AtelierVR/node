import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { StorageController } from './storage.controller';
import { LocalFileProvider } from './local-file.provider';
import { FediverseModule } from '../fediverse/fediverse.module';

@Module({
  imports: [FediverseModule],
  controllers: [StorageController],
  providers: [
    { provide: 'IStorageProvider', useClass: LocalFileProvider },
    StorageService,
    LocalFileProvider,
  ],
  exports: [StorageService],
})
export class StorageModule {}
