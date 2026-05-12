import { Module, forwardRef } from '@nestjs/common';
import { WsGateway } from './ws.gateway';
import { WsService } from './ws.service';
import { UsersModule } from '../users/users.module';
import { SessionService } from '../auth/session.service';
import { RelayModule } from '../relay/relay.module';
import { AppConfigModule } from '../config/config.module';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
    imports: [
        AppConfigModule,
        GatewayModule,
        forwardRef(() => UsersModule),
        forwardRef(() => RelayModule),
    ],
    providers: [WsGateway, WsService, SessionService],
    exports: [WsService, WsGateway],
})
export class WsModule { }
