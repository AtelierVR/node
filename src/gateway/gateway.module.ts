import { Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { EventsService } from './events.service';
import { UsersModule } from '../users/users.module';

@Module({
    imports: [UsersModule],
    providers: [EventsGateway, EventsService],
    exports: [EventsService],
})
export class GatewayModule { }
