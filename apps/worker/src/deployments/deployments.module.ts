import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QueueName } from '@selfship/shared';
import { DomainsModule } from '../domains/domains.module';
import { ServersModule } from '../servers/servers.module';
import { DeploymentRunner } from './deployment.runner';
import { DeploymentsProcessor } from './deployments.processor';
import { TeardownService } from './teardown.service';

/** Deployments: clone, build and run apps on users' servers. */
@Module({
  imports: [
    BullModule.registerQueue({ name: QueueName.DEPLOYMENTS }),
    ServersModule,
    DomainsModule,
  ],
  providers: [DeploymentsProcessor, DeploymentRunner, TeardownService],
})
export class DeploymentsModule {}
