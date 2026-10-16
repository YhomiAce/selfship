import { Module } from '@nestjs/common';
import { ServerJobStreamService } from './server-job-stream.service';
import { ServersController } from './servers.controller';
import { ServersService } from './servers.service';

/** Servers: CRUD, check/setup jobs (run by the worker), live job logs. */
@Module({
  controllers: [ServersController],
  providers: [ServersService, ServerJobStreamService],
})
export class ServersModule {}
