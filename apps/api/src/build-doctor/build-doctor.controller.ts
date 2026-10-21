import {
  Body,
  Controller,
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
import {
  type DiagnosisDto,
  DiagnosisFeedbackSchema,
  type DiagnosisResponse,
} from '@selfship/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BuildDoctorService } from './build-doctor.service';

/** Body of `POST …/diagnosis/feedback`. */
class DiagnosisFeedbackDto extends createZodDto(DiagnosisFeedbackSchema) {}

/** Build Doctor (AI diagnosis) of a deployment. */
@Controller('projects/:projectId/deployments/:deploymentId/diagnosis')
export class BuildDoctorController {
  constructor(private readonly doctor: BuildDoctorService) {}

  /**
   * The diagnosis, if any, and whether Build Doctor is available.
   *
   * @param projectId - Project ID
   * @param deploymentId - Deployment ID
   */
  @Get()
  get(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('deploymentId', ParseUUIDPipe) deploymentId: string,
  ): Promise<DiagnosisResponse> {
    return this.doctor.get(user.id, projectId, deploymentId);
  }

  /**
   * Asks for a diagnosis of a failed deployment.
   *
   * @param projectId - Project ID
   * @param deploymentId - Deployment ID
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  request(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('deploymentId', ParseUUIDPipe) deploymentId: string,
  ): Promise<DiagnosisResponse> {
    return this.doctor.request(user.id, projectId, deploymentId);
  }

  /**
   * Rates a diagnosis.
   *
   * @param projectId - Project ID
   * @param deploymentId - Deployment ID
   * @param body - Helpful or not, optional comment
   */
  @Post('feedback')
  @HttpCode(HttpStatus.OK)
  feedback(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('deploymentId', ParseUUIDPipe) deploymentId: string,
    @Body() body: DiagnosisFeedbackDto,
  ): Promise<DiagnosisDto> {
    return this.doctor.feedback(user.id, projectId, deploymentId, body);
  }

  /**
   * Applies the suggested settings fix.
   *
   * @param projectId - Project ID
   * @param deploymentId - Deployment ID
   */
  @Post('apply')
  @HttpCode(HttpStatus.OK)
  apply(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('deploymentId', ParseUUIDPipe) deploymentId: string,
  ): Promise<{ applied: string }> {
    return this.doctor.apply(user.id, projectId, deploymentId);
  }
}
