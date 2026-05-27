import { Module, forwardRef } from '@nestjs/common';
import { ActivityService } from './activity.service';
import { ActivityController } from './activity.controller';
import { UsersModule } from '../users/users.module';
import { GatewayModule } from '../gateway/gateway.module';
import { FediverseModule } from '../fediverse/fediverse.module';

@Module({
    imports: [
        forwardRef(() => UsersModule),
        forwardRef(() => GatewayModule),
        FediverseModule,
    ],
    controllers: [ActivityController],
    providers: [ActivityService],
    exports: [ActivityService],
})
export class ActivityModule { }
