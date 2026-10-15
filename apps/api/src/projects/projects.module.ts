import { Module } from '@nestjs/common';
import { GithubModule } from '../github/github.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

/** Projects: detection, CRUD. */
@Module({
  imports: [GithubModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
})
export class ProjectsModule {}
