import { Module } from '@nestjs/common';
import { DeploymentsModule } from '../deployments/deployments.module';
import { cloudflareProvider } from './cloudflare.provider';
import { DomainsController } from './domains.controller';
import { DomainsService } from './domains.service';

/** Project domains (free subdomains and custom domains). */
@Module({
  imports: [DeploymentsModule],
  controllers: [DomainsController],
  providers: [DomainsService, cloudflareProvider],
  exports: [DomainsService],
})
export class DomainsModule {}
