import { Module, forwardRef } from '@nestjs/common';
import { StorageService } from './storage.service';
import { StorageController } from './storage.controller';
import { LocalFileProvider } from './local-file.provider';
import { ImageResizeService } from './image-resize.service';
import { FediverseModule } from '../fediverse/fediverse.module';

@Module({
  imports: [forwardRef(() => FediverseModule)],
  controllers: [StorageController],
  providers: [
    { provide: 'IStorageProvider', useClass: LocalFileProvider },
    StorageService,
    LocalFileProvider,
    ImageResizeService,
  ],
  exports: [StorageService, ImageResizeService],
})
export class StorageModule {}
