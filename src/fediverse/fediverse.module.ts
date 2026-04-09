import { Module } from '@nestjs/common';
import { FediverseService } from './fediverse.service';
import { WellKnownService } from './well-known.service';
import { WellKnownController } from './well-known.controller';
import { NodeInfoController } from './nodeinfo.controller';

@Module({
  controllers: [WellKnownController, NodeInfoController],
  providers: [FediverseService, WellKnownService],
  exports: [FediverseService, WellKnownService],
})
export class FediverseModule {}
