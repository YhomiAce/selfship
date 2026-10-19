import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QueueName } from '@selfship/shared';
import { ServersModule } from '../servers/servers.module';
import { DeploymentLauncher } from './deployment-launcher.service';
import { DomainChecker } from './domain-checker.service';
import { DomainRoutingService } from './domain-routing.service';
import { DomainsProcessor } from './domains.processor';

/** Domains: free subdomains, custom domain verification, certificates. */
@Module({
  imports: [
    BullModule.registerQueue({ name: QueueName.DOMAINS }, { name: QueueName.DEPLOYMENTS }),
    ServersModule,
  ],
  providers: [DomainRoutingService, DomainChecker, DeploymentLauncher, DomainsProcessor],
  exports: [DomainRoutingService],
})
export class DomainsModule {}
