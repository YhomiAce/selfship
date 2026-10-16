import { Module } from '@nestjs/common';
import { ServersController } from './servers.controller';
import { ServersService } from './servers.service';

/** Servers: CRUD, check/setup jobs (run by the worker), live job logs. */
@Module({
  controllers: [ServersController],
  providers: [ServersService],
})
export class ServersModule {}
