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
  Put,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { createZodDto, ZodValidationPipe } from 'nestjs-zod';
import type { User } from '@selfship/db';
import {
  EnvKeySchema,
  type EnvVarDto,
  type EnvVarListResponse,
  type EnvVarValueResponse,
  UpdateEnvVarSchema,
  UpsertEnvVarsSchema,
} from '@selfship/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { EnvVarsService } from './env-vars.service';

/** Body of `PUT /projects/:projectId/env`. */
class UpsertEnvVarsDto extends createZodDto(UpsertEnvVarsSchema) {}
/** Body of `PATCH /projects/:projectId/env/:key`. */
class UpdateEnvVarDto extends createZodDto(UpdateEnvVarSchema) {}

/** Validates the `:key` route parameter. */
const KeyPipe = new ZodValidationPipe(EnvKeySchema);

/** Environment variables of a project. */
@Controller('projects/:projectId/env')
export class EnvVarsController {
  constructor(private readonly envVars: EnvVarsService) {}

  /**
   * Lists variables (without values).
   *
   * @param projectId - Project ID
   * @returns Variables
   */
  @Get()
  async list(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<EnvVarListResponse> {
    return { items: await this.envVars.list(user.id, projectId) };
  }

  /**
   * Creates or replaces variables.
   *
   * @param projectId - Project ID
   * @param body - Variables
   * @returns All variables
   */
  @Put()
  async upsert(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: UpsertEnvVarsDto,
  ): Promise<EnvVarListResponse> {
    return { items: await this.envVars.upsert(user.id, projectId, body) };
  }

  /**
   * Changes a variable's scope.
   *
   * @param projectId - Project ID
   * @param key - Variable name
   * @param body - New scope
   * @returns The variable
   */
  @Patch(':key')
  updateScope(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('key', KeyPipe) key: string,
    @Body() body: UpdateEnvVarDto,
  ): Promise<EnvVarDto> {
    return this.envVars.updateScope(user.id, projectId, key, body.scope);
  }

  /**
   * Reveals a value. Rate limited: it's the one endpoint that returns secrets.
   *
   * @param projectId - Project ID
   * @param key - Variable name
   * @returns Name and value
   */
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':key/value')
  reveal(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('key', KeyPipe) key: string,
  ): Promise<EnvVarValueResponse> {
    return this.envVars.reveal(user.id, projectId, key);
  }

  /**
   * Deletes a variable.
   *
   * @param projectId - Project ID
   * @param key - Variable name
   */
  @Delete(':key')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('key', KeyPipe) key: string,
  ): Promise<void> {
    return this.envVars.remove(user.id, projectId, key);
  }
}
