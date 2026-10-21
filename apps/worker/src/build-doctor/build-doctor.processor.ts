import { Processor, WorkerHost } from '@nestjs/bullmq';
import { type Job, UnrecoverableError } from 'bullmq';
import { BuildDoctorJob, DiagnoseJobDataSchema, QueueName } from '@selfship/shared';
import { BuildDoctorService } from './build-doctor.service';

/** Consumes the `build-doctor` queue (two diagnoses at a time). */
@Processor(QueueName.BUILD_DOCTOR, { concurrency: 2 })
export class BuildDoctorProcessor extends WorkerHost {
  constructor(private readonly doctor: BuildDoctorService) {
    super();
  }

  /**
   * Validates the payload and produces the diagnosis.
   *
   * @param job - BullMQ job carrying `{ diagnosisId }`
   * @throws {UnrecoverableError} For unknown names or malformed payloads
   */
  async process(job: Job<unknown>): Promise<void> {
    if (job.name !== BuildDoctorJob.DIAGNOSE)
      throw new UnrecoverableError(`Unknown build-doctor job: ${job.name}`);
    const parsed = DiagnoseJobDataSchema.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError('Invalid build-doctor job payload');
    await this.doctor.run(parsed.data.diagnosisId);
  }
}
