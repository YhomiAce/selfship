import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import type { User } from '@selfship/db';
import type { DetectProjectResponse, ProjectDto, ProjectListResponse } from '@selfship/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateProjectDto, DetectProjectDto, UpdateProjectDto } from './dto/project.dto';
import { ProjectsService } from './projects.service';

/** Projects of the signed-in user. */
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  /**
   * Suggests build settings for a repository folder (nothing is saved).
   *
   * @param body - Installation, repository, branch and folder
   * @returns Detection result
   */
  @Post('detect')
  @HttpCode(HttpStatus.OK)
  detect(
    @CurrentUser() user: User,
    @Body() body: DetectProjectDto,
  ): Promise<DetectProjectResponse> {
    return this.projects.detect(user.id, body);
  }

  /**
   * Creates a project.
   *
   * @param body - Name, source and settings
   * @returns The new project
   */
  @Post()
  create(@CurrentUser() user: User, @Body() body: CreateProjectDto): Promise<ProjectDto> {
    return this.projects.create(user.id, body);
  }

  /**
   * Lists the user's projects.
   *
   * @returns Projects, newest first
   */
  @Get()
  async list(@CurrentUser() user: User): Promise<ProjectListResponse> {
    return { items: await this.projects.list(user.id) };
  }

  /**
   * Fetches one project.
   *
   * @param id - Project ID
   * @returns The project
   */
  @Get(':id')
  get(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<ProjectDto> {
    return this.projects.get(user.id, id);
  }

  /**
   * Updates a project.
   *
   * @param id - Project ID
   * @param body - Fields to change
   * @returns The updated project
   */
  @Patch(':id')
  update(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateProjectDto,
  ): Promise<ProjectDto> {
    return this.projects.update(user.id, id, body);
  }

  /**
   * Deletes a project.
   *
   * @param id - Project ID
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.projects.remove(user.id, id);
  }
}
