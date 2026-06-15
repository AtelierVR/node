import { Module, forwardRef } from '@nestjs/common';
import { ExternalUsersService } from './external-users.service';
import { FediverseModule } from 'src/fediverse/fediverse.module';
import { ExternalServersModule } from './external-servers.module';

@Module({
  imports: [forwardRef(() => FediverseModule), ExternalServersModule],
  controllers: [],
  providers: [ExternalUsersService],
  exports: [ExternalUsersService],
})
export class ExternalUsersModule {}
