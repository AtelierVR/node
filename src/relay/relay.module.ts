import { Module, forwardRef } from '@nestjs/common';
import { RelayService } from './relay.service';
import { RelayGateway } from './relay.gateway';
import { RelayController } from './relay.controller';
import { RelayAutoManager } from './relay-auto-manager.service';
import { InstanceDistributorService } from './instance-distributor.service';
import { GatewayModule } from '../gateway/gateway.module';
import { FediverseModule } from '../fediverse/fediverse.module';
import { AppConfigModule } from '../config/config.module';
import { AuthModule } from '../auth/auth.module';
import { InstancesModule } from '../instances/instances.module';
import { ActivityModule } from '../activity/activity.module';
import { RunnerFactory, RELAY_RUNNERS } from './runners/runner.factory';
import { DockerRunner } from './runners/docker/docker.runner';
import { ExternalRunner } from './runners/external/external.runner';
import { WsModule } from '../ws/ws.module';
import { ExternalUsersModule } from '../external/external-users.module';

@Module({
    imports: [
        GatewayModule,
        forwardRef(() => FediverseModule),
        AppConfigModule,
        AuthModule,
        ActivityModule,
        forwardRef(() => InstancesModule),
        forwardRef(() => WsModule),
        ExternalUsersModule,
    ],
    controllers: [RelayController],
    providers: [
        RelayService, RelayGateway, RelayAutoManager, InstanceDistributorService,
        DockerRunner, ExternalRunner,
        {
            provide: RELAY_RUNNERS,
            useFactory: (docker: DockerRunner, external: ExternalRunner) => [docker, external],
            inject: [DockerRunner, ExternalRunner],
        },
        RunnerFactory,
    ],
    exports: [RelayService, RelayGateway],
})
export class RelayModule { }
