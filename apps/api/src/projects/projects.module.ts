import { Module } from '@nestjs/common';
import { DomainsModule } from '../domains/domains.module';
import { SandboxModule } from '../sandbox/sandbox.module';
import { GithubModule } from '../github/github.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

/** Projects: detection, CRUD. */
@Module({
  imports: [GithubModule, DomainsModule, SandboxModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
})
export class ProjectsModule {}
