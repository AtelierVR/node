import { Module, forwardRef } from '@nestjs/common';
import { RelayService } from './relay.service';
import { RelayGateway } from './relay.gateway';
import { RelayController } from './relay.controller';
import { GatewayModule } from '../gateway/gateway.module';
import { FediverseModule } from '../fediverse/fediverse.module';
import { AppConfigModule } from '../config/config.module';
import { AuthModule } from '../auth/auth.module';
import { InstancesModule } from '../instances/instances.module';

@Module({
    imports: [
        GatewayModule,
        FediverseModule,
        AppConfigModule,
        AuthModule,
        forwardRef(() => InstancesModule),
    ],
    controllers: [RelayController],
    providers: [RelayService, RelayGateway],
    exports: [RelayService, RelayGateway],
})
export class RelayModule { }
