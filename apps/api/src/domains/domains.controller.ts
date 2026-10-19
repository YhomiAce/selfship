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
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { createZodDto } from 'nestjs-zod';
import type { User } from '@selfship/db';
import { AddDomainSchema, type DomainDto, type DomainListResponse } from '@selfship/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DomainsService } from './domains.service';

/** Body of `POST /projects/:projectId/domains`. */
class AddDomainDto extends createZodDto(AddDomainSchema) {}

/** Domains of a project. */
@Controller('projects/:projectId/domains')
export class DomainsController {
  constructor(private readonly domains: DomainsService) {}

  /**
   * Lists domains with the DNS records to create.
   *
   * @param projectId - Project ID
   * @returns Domains
   */
  @Get()
  async list(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<DomainListResponse> {
    return { items: await this.domains.list(user.id, projectId) };
  }

  /**
   * Adds a custom domain (optionally with www).
   *
   * @param projectId - Project ID
   * @param body - Hostname and www option
   * @returns All domains of the project
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post()
  async add(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: AddDomainDto,
  ): Promise<DomainListResponse> {
    return { items: await this.domains.add(user.id, projectId, body) };
  }

  /**
   * Checks a domain now (DNS, or the certificate once routed).
   *
   * @param projectId - Project ID
   * @param id - Domain ID
   * @returns The domain
   */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post(':id/check')
  @HttpCode(HttpStatus.OK)
  check(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DomainDto> {
    return this.domains.check(user.id, projectId, id);
  }

  /**
   * Removes a custom domain.
   *
   * @param projectId - Project ID
   * @param id - Domain ID
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.domains.remove(user.id, projectId, id);
  }
}
