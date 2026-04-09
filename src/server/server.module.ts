import { Module, forwardRef } from '@nestjs/common';
import { ServerController } from './server.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [forwardRef(() => UsersModule)],
  controllers: [ServerController],
  providers: [],
})
export class ServerModule {}
