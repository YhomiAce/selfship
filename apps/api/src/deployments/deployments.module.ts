import { Module } from '@nestjs/common';
import { GithubModule } from '../github/github.module';
import { DeploymentsController } from './deployments.controller';
import { DeploymentsService } from './deployments.service';

/** Deployments: started here, run by the worker. */
@Module({
  imports: [GithubModule],
  controllers: [DeploymentsController],
  providers: [DeploymentsService],
})
export class DeploymentsModule {}
