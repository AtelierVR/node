import { Module, forwardRef } from '@nestjs/common';
import { FediverseService } from './fediverse.service';
import { WellKnownService } from './well-known.service';
import { WellKnownController } from './well-known.controller';
import { NodeInfoController } from './nodeinfo.controller';
import { ActivityPubService } from './activitypub/activitypub.service';
import { ActivityPubController } from './activitypub/activitypub.controller';
import { AppConfigModule } from '../config/config.module';
import { PrismaModule } from '../database/prisma.module';
import { UsersModule } from '../users/users.module';

@Module({
    imports: [AppConfigModule, PrismaModule, forwardRef(() => UsersModule)],
    controllers: [WellKnownController, NodeInfoController, ActivityPubController],
    providers: [FediverseService, WellKnownService, ActivityPubService],
    exports: [FediverseService, WellKnownService, ActivityPubService],
})
export class FediverseModule {}
