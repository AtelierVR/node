import { Module, forwardRef } from '@nestjs/common';
import { RelayService } from './relay.service';
import { RelayGateway } from './relay.gateway';
import { RelayController } from './relay.controller';
import { RelayAutoManager } from './relay-auto-manager.service';
import { GatewayModule } from '../gateway/gateway.module';
import { FediverseModule } from '../fediverse/fediverse.module';
import { AppConfigModule } from '../config/config.module';
import { AuthModule } from '../auth/auth.module';
import { InstancesModule } from '../instances/instances.module';
import { ActivityModule } from '../activity/activity.module';
import { RunnerFactory } from './runners/runner.factory';
import { DockerRunner } from './runners/docker/docker.runner';
import { ExternalRunner } from './runners/external/external.runner';
import { WsModule } from '../ws/ws.module';

@Module({
    imports: [
        GatewayModule,
        FediverseModule,
        AppConfigModule,
        AuthModule,
        ActivityModule,
        forwardRef(() => InstancesModule),
        forwardRef(() => WsModule),
    ],
    controllers: [RelayController],
    providers: [RelayService, RelayGateway, RelayAutoManager, RunnerFactory, DockerRunner, ExternalRunner],
    exports: [RelayService, RelayGateway],
})
export class RelayModule { }
