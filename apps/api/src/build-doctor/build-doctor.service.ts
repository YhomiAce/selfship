import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import type { BuildDiagnosis, Deployment, Project } from '@selfship/db';
import {
  BuildDoctorErrorCode,
  BuildDoctorJob,
  type DiagnoseJobData,
  type DiagnosisDto,
  type DiagnosisFeedbackInput,
  type DiagnosisResponse,
  DiagnosisSchema,
  ErrorCode,
  type ProjectSettings,
  QueueName,
  settingsAfterRemediation,
} from '@selfship/shared';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const NOT_FOUND = { code: ErrorCode.NOT_FOUND, message: 'Deployment not found.' };

/**
 * Build Doctor from the dashboard: read a diagnosis, ask for one, rate it,
 * and apply a suggested settings fix. The worker does the AI work.
 */
@Injectable()
export class BuildDoctorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    @InjectQueue(QueueName.BUILD_DOCTOR) private readonly queue: Queue<DiagnoseJobData>,
    private readonly audit: AuditService,
  ) {}

  /**
   * The diagnosis of a deployment, if any.
   *
   * @param userId - Signed-in user
   * @param projectId - Project ID
   * @param deploymentId - Deployment ID
   * @returns Whether Build Doctor is available, and the diagnosis
   */
  async get(userId: string, projectId: string, deploymentId: string): Promise<DiagnosisResponse> {
    const { project } = await this.find(userId, projectId, deploymentId);
    const diagnosis = await this.prisma.buildDiagnosis.findUnique({ where: { deploymentId } });
    return {
      available: this.enabled(project),
      diagnosis: diagnosis ? toDiagnosisDto(diagnosis, project) : null,
    };
  }

  /**
   * Asks Build Doctor to diagnose a failed deployment (e.g. one a hint rule
   * already explained, or a diagnosis that failed earlier).
   *
   * @param userId - Signed-in user
   * @param projectId - Project ID
   * @param deploymentId - Failed deployment
   * @returns The pending (or existing) diagnosis
   * @throws {BadRequestException} `BUILD_DOCTOR_UNAVAILABLE` / `NOT_DIAGNOSABLE`
   */
  async request(
    userId: string,
    projectId: string,
    deploymentId: string,
  ): Promise<DiagnosisResponse> {
    const { project, deployment } = await this.find(userId, projectId, deploymentId);
    if (!this.enabled(project)) {
      throw new BadRequestException({
        code: BuildDoctorErrorCode.BUILD_DOCTOR_UNAVAILABLE,
        message: this.config.get('ANTHROPIC_API_KEY')
          ? 'Build Doctor is turned off for this project.'
          : 'Build Doctor is not set up on this Selfship.',
      });
    }
    if (deployment.status !== 'failed') {
      throw new BadRequestException({
        code: BuildDoctorErrorCode.NOT_DIAGNOSABLE,
        message: 'Only failed deployments can be diagnosed.',
      });
    }
    const existing = await this.prisma.buildDiagnosis.findUnique({ where: { deploymentId } });
    if (existing && (existing.status === 'pending' || existing.status === 'ready')) {
      return { available: true, diagnosis: toDiagnosisDto(existing, project) };
    }
    const diagnosis = existing
      ? await this.prisma.buildDiagnosis.update({
          where: { id: existing.id },
          data: { status: 'pending', error: null, finishedAt: null },
        })
      : await this.prisma.buildDiagnosis.create({
          data: { deploymentId, projectId, userId: project.userId },
        });
    await this.queue.add(
      BuildDoctorJob.DIAGNOSE,
      { diagnosisId: diagnosis.id },
      {
        jobId: `${diagnosis.id}-${Date.now()}`,
        attempts: 2,
        backoff: { type: 'exponential', delay: 10_000 },
      },
    );
    return { available: true, diagnosis: toDiagnosisDto(diagnosis, project) };
  }

  /**
   * Records 👍/👎 on a diagnosis (to measure quality).
   *
   * @param userId - Signed-in user
   * @param projectId - Project ID
   * @param deploymentId - Deployment ID
   * @param input - Helpful or not, optional comment
   * @returns The diagnosis
   */
  async feedback(
    userId: string,
    projectId: string,
    deploymentId: string,
    input: DiagnosisFeedbackInput,
  ): Promise<DiagnosisDto> {
    const { project } = await this.find(userId, projectId, deploymentId);
    const existing = await this.prisma.buildDiagnosis.findUnique({ where: { deploymentId } });
    if (!existing)
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'No diagnosis yet.' });
    const updated = await this.prisma.buildDiagnosis.update({
      where: { id: existing.id },
      data: { feedback: input.helpful ? 1 : -1, feedbackComment: input.comment ?? null },
    });
    return toDiagnosisDto(updated, project);
  }

  /**
   * Applies the suggested settings fix ("Apply fix"). The user deploys
   * afterwards; nothing runs on the server here.
   *
   * @param userId - Signed-in user
   * @param projectId - Project ID
   * @param deploymentId - Diagnosed deployment
   * @returns What changed
   * @throws {ConflictException} `NOTHING_TO_APPLY`
   */
  async apply(
    userId: string,
    projectId: string,
    deploymentId: string,
  ): Promise<{ applied: string }> {
    const { project } = await this.find(userId, projectId, deploymentId);
    const existing = await this.prisma.buildDiagnosis.findUnique({ where: { deploymentId } });
    const parsed = DiagnosisSchema.safeParse(existing?.result);
    const change = parsed.success
      ? settingsAfterRemediation(settingsOf(project), parsed.data.remediation)
      : null;
    if (!change) {
      throw new ConflictException({
        code: BuildDoctorErrorCode.NOTHING_TO_APPLY,
        message: 'This diagnosis has no settings change to apply.',
      });
    }
    await this.prisma.project.update({
      where: { id: project.id },
      data: {
        installCommand: change.settings.installCommand,
        buildCommand: change.settings.buildCommand,
        startCommand: change.settings.startCommand,
        outputDirectory: change.settings.outputDirectory,
        port: change.settings.port,
        nodeVersion: change.settings.nodeVersion,
      },
    });
    await this.audit.record(
      userId,
      'build_doctor.fix_applied',
      { type: 'project', id: project.id, name: project.name },
      {
        change: change.description,
      },
    );
    return { applied: change.description };
  }

  /** Build Doctor works when the worker has a key and the project hasn't turned it off. */
  private enabled(project: Project): boolean {
    return Boolean(this.config.get('ANTHROPIC_API_KEY')) && project.buildDoctor;
  }

  /** A deployment of one of the user's projects, with its project (404 otherwise). */
  private async find(
    userId: string,
    projectId: string,
    deploymentId: string,
  ): Promise<{ deployment: Deployment; project: Project }> {
    const deployment = await this.prisma.deployment.findFirst({
      where: { id: deploymentId, projectId, project: { userId } },
      include: { project: true },
    });
    if (!deployment) throw new NotFoundException(NOT_FOUND);
    return { deployment, project: deployment.project };
  }
}

/** A project's build settings as the shared type. */
function settingsOf(project: Project): ProjectSettings {
  return {
    adapter: project.adapter,
    installCommand: project.installCommand,
    buildCommand: project.buildCommand,
    startCommand: project.startCommand,
    outputDirectory: project.outputDirectory,
    port: project.port,
    nodeVersion: project.nodeVersion,
  };
}

/**
 * Public shape of a diagnosis. The stored result is validated again here:
 * it came from a model.
 *
 * @param diagnosis - Record
 * @param project - Its project (to work out whether the fix can be applied)
 * @returns DTO
 */
export function toDiagnosisDto(diagnosis: BuildDiagnosis, project: Project): DiagnosisDto {
  const parsed = diagnosis.result ? DiagnosisSchema.safeParse(diagnosis.result) : null;
  const result = parsed?.success ? parsed.data : null;
  return {
    id: diagnosis.id,
    deploymentId: diagnosis.deploymentId,
    status: diagnosis.status === 'ready' && !result ? 'failed' : diagnosis.status,
    result,
    error:
      diagnosis.status === 'ready' && !result
        ? 'The stored diagnosis is unreadable.'
        : diagnosis.error,
    cached: diagnosis.cached,
    autoRemediation: diagnosis.autoRemediation,
    canApply: result
      ? settingsAfterRemediation(settingsOf(project), result.remediation) !== null
      : false,
    feedback: diagnosis.feedback === 1 ? 'up' : diagnosis.feedback === -1 ? 'down' : null,
    createdAt: diagnosis.createdAt.toISOString(),
  };
}
