import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Global module that provides a single shared PrismaService instance.
 * Marking it @Global() ensures PrismaService.onModuleInit() (which calls
 * $connect() and resolves the `ready` promise) runs during AppModule's
 * lifecycle — before any feature module's onModuleInit hooks fire.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
