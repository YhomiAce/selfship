import {
  Body,
  Controller,
  Delete,
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
import { ZodValidationPipe } from 'nestjs-zod';
import type { User } from '@selfship/db';
import {
  type CreateServerInput,
  CreateServerSchema,
  type DeleteServerResponse,
  type ServerDto,
  type ServerJobDetailDto,
  type ServerJobDto,
  type ServerJobEvent,
  type ServerJobListResponse,
  type ServerListResponse,
  serverJobStreamKey,
} from '@selfship/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { LogStreamService } from '../logs/log-stream.service';
import { ServersService } from './servers.service';

/** Servers of the signed-in user: add, inspect, set up, remove, watch logs. */
@Controller('servers')
export class ServersController {
  constructor(
    private readonly servers: ServersService,
    private readonly streams: LogStreamService,
  ) {}

  /**
   * Lists servers.
   *
   * @returns Servers with their latest job
   */
  @Get()
  async list(@CurrentUser() user: User): Promise<ServerListResponse> {
    return { items: await this.servers.list(user.id) };
  }

  /**
   * Adds a server (generated key, pasted key, or one-time password).
   *
   * @param body - Name, host, port, user and access method
   * @returns The new server
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  create(
    @CurrentUser() user: User,
    // A union of three shapes (one per access method), so it's validated with
    // the schema directly rather than a DTO class.
    @Body(new ZodValidationPipe(CreateServerSchema)) body: CreateServerInput,
  ): Promise<ServerDto> {
    return this.servers.create(user.id, body);
  }

  /**
   * Fetches one server.
   *
   * @param id - Server ID
   * @returns The server
   */
  @Get(':id')
  get(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<ServerDto> {
    return this.servers.get(user.id, id);
  }

  /**
   * Connects and re-inspects the server without changing it.
   *
   * @param id - Server ID
   * @returns The queued job
   */
  @Post(':id/check')
  @HttpCode(HttpStatus.ACCEPTED)
  check(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<ServerJobDto> {
    return this.servers.startJob(user.id, id, 'check');
  }

  /**
   * Inspects, then sets up the server (safe to run again).
   *
   * @param id - Server ID
   * @returns The queued job
   */
  @Post(':id/setup')
  @HttpCode(HttpStatus.ACCEPTED)
  setup(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<ServerJobDto> {
    return this.servers.startJob(user.id, id, 'setup');
  }

  /**
   * Lists recent jobs.
   *
   * @param id - Server ID
   * @returns Jobs, newest first
   */
  @Get(':id/jobs')
  async jobs(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ServerJobListResponse> {
    return { items: await this.servers.listJobs(user.id, id) };
  }

  /**
   * Fetches a job with its saved log.
   *
   * @param id - Server ID
   * @param jobId - Job ID
   * @returns The job
   */
  @Get(':id/jobs/:jobId')
  job(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ): Promise<ServerJobDetailDto> {
    return this.servers.getJob(user.id, id, jobId);
  }

  /**
   * Live log of a job as Server-Sent Events: every line so far, then new
   * lines as they happen, then an `end` event. Browsers reconnect
   * automatically and resume after the last event they received.
   *
   * @param id - Server ID
   * @param jobId - Job ID
   */
  @SkipThrottle()
  @Get(':id/jobs/:jobId/stream')
  async stream(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const job = await this.servers.findOwnedJob(user.id, id, jobId);
    await this.streams.relay(req, res, {
      key: serverJobStreamKey(jobId),
      finished: job.status === 'succeeded' || job.status === 'failed',
      replay: () => {
        const events: ServerJobEvent[] = job.log
          .split('\n')
          .filter(Boolean)
          .map((line) => ({ type: 'line', line }));
        events.push({
          type: 'end',
          status: job.status === 'succeeded' ? 'succeeded' : 'failed',
          error: job.error,
        });
        return Promise.resolve(events.map((event) => JSON.stringify(event)));
      },
    });
  }

  /**
   * Removes a server from Selfship (the server itself is not changed).
   *
   * @param id - Server ID
   * @returns The command to revoke our key on the server
   */
  @Delete(':id')
  remove(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DeleteServerResponse> {
    return this.servers.remove(user.id, id);
  }
}
