import { Module } from '@nestjs/common';
import { DeploymentsModule } from '../deployments/deployments.module';
import { GithubModule } from '../github/github.module';
import { GithubWebhooksController } from './github-webhooks.controller';

/**
 * Incoming webhooks. Separate from the GitHub and deployments modules because
 * it needs both (installation changes, auto-deploy on push).
 */
@Module({
  imports: [GithubModule, DeploymentsModule],
  controllers: [GithubWebhooksController],
})
export class WebhooksModule {}
