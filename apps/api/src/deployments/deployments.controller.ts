import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import type { User } from '@selfship/db';
import {
  ACTIVE_DEPLOYMENT_STATUSES,
  CreateDeploymentSchema,
  type DeploymentDto,
  type DeploymentListResponse,
  deploymentStreamKey,
} from '@selfship/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { LogStreamService } from '../logs/log-stream.service';
import { DeploymentsService } from './deployments.service';

/** Body of `POST /projects/:projectId/deployments`. */
class CreateDeploymentDto extends createZodDto(CreateDeploymentSchema) {}

/** Deployments of a project: start, list, cancel, roll back, watch. */
@Controller('projects/:projectId/deployments')
export class DeploymentsController {
  constructor(
    private readonly deployments: DeploymentsService,
    private readonly streams: LogStreamService,
  ) {}

  /**
   * Deploys the latest commit of the project's branch, or the given commit.
   *
   * @param projectId - Project ID
   * @param body - Optional `commitSha` to redeploy
   * @returns The queued deployment
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  create(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: CreateDeploymentDto,
  ): Promise<DeploymentDto> {
    return this.deployments.create(user.id, projectId, body);
  }

  /**
   * Puts an earlier deployment live again using its image (no rebuild).
   *
   * @param projectId - Project ID
   * @param id - Deployment to go back to
   * @returns The queued rollback
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':id/rollback')
  @HttpCode(HttpStatus.ACCEPTED)
  rollback(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DeploymentDto> {
    return this.deployments.rollback(user.id, projectId, id);
  }

  /**
   * Lists recent deployments.
   *
   * @param projectId - Project ID
   * @returns Deployments, newest first
   */
  @Get()
  async list(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<DeploymentListResponse> {
    return { items: await this.deployments.list(user.id, projectId) };
  }

  /**
   * Fetches one deployment.
   *
   * @param projectId - Project ID
   * @param id - Deployment ID
   * @returns The deployment
   */
  @Get(':id')
  get(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DeploymentDto> {
    return this.deployments.get(user.id, projectId, id);
  }

  /**
   * Cancels a queued or running deployment (the previous version stays live).
   *
   * @param projectId - Project ID
   * @param id - Deployment ID
   * @returns The deployment
   */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.ACCEPTED)
  cancel(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DeploymentDto> {
    return this.deployments.cancel(user.id, projectId, id);
  }

  /**
   * Streams the deployment's log as Server-Sent Events (`DeploymentEvent` JSON).
   * Replays from the start, then follows live; resumes with `Last-Event-ID`.
   *
   * @param projectId - Project ID
   * @param id - Deployment ID
   */
  @SkipThrottle()
  @Get(':id/stream')
  async stream(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const deployment = await this.deployments.findOwned(user.id, projectId, id);
    await this.streams.relay(req, res, {
      key: deploymentStreamKey(id),
      finished: !ACTIVE_DEPLOYMENT_STATUSES.includes(deployment.status),
      replay: () => this.deployments.savedEvents(deployment),
    });
  }
}
