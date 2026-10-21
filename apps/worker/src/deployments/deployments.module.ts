import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QueueName } from '@selfship/shared';
import { BuildDoctorModule } from '../build-doctor/build-doctor.module';
import { DomainsModule } from '../domains/domains.module';
import { ServersModule } from '../servers/servers.module';
import { DeploymentRunner } from './deployment.runner';
import { DeploymentsProcessor } from './deployments.processor';
import { SandboxExpiryService } from './sandbox-expiry.service';
import { TeardownService } from './teardown.service';

/** Deployments: clone, build and run apps on users' servers. */
@Module({
  imports: [
    BullModule.registerQueue({ name: QueueName.DEPLOYMENTS }),
    ServersModule,
    DomainsModule,
    BuildDoctorModule,
  ],
  providers: [DeploymentsProcessor, DeploymentRunner, TeardownService, SandboxExpiryService],
  exports: [SandboxExpiryService],
})
export class DeploymentsModule {}
