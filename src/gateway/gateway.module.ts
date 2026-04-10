import { Module, forwardRef } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { EventsService } from './events.service';
import { UsersModule } from '../users/users.module';
import { SessionService } from '../auth/session.service';

@Module({
    imports: [
        forwardRef(() => UsersModule)
    ],
    providers: [
        EventsGateway,
        EventsService,
        SessionService
    ],
    exports: [EventsService],
})
export class GatewayModule { }
