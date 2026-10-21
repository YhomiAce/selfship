import { BullModule } from '@nestjs/bullmq';
import { Logger, Module } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { QueueName } from '@selfship/shared';
import { AppConfigService } from '../config/app-config.service';
import { DomainsModule } from '../domains/domains.module';
import { ServersModule } from '../servers/servers.module';
import { BuildDoctorProcessor } from './build-doctor.processor';
import { BuildDoctorService, DIAGNOSIS_MODEL } from './build-doctor.service';
import { ClaudeDiagnosisModel, type DiagnosisModel } from './claude';

/**
 * Creates the Claude-backed diagnosis model, or null without an API key
 * (Build Doctor is then off and users see only rule-based hints).
 *
 * @param config - Validated configuration
 * @returns Model or null
 */
export function createDiagnosisModel(config: AppConfigService): DiagnosisModel | null {
  const apiKey = config.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    new Logger('BuildDoctor').log('Build Doctor is off (no ANTHROPIC_API_KEY)');
    return null;
  }
  return new ClaudeDiagnosisModel(new Anthropic({ apiKey }), {
    model: config.get('BUILD_DOCTOR_MODEL'),
    effort: config.get('BUILD_DOCTOR_EFFORT'),
    fallbacks: config.get('BUILD_DOCTOR_FALLBACKS'),
  });
}

/** Build Doctor: AI diagnosis of failed deployments. */
@Module({
  imports: [
    BullModule.registerQueue({ name: QueueName.BUILD_DOCTOR }),
    ServersModule,
    DomainsModule,
  ],
  providers: [
    { provide: DIAGNOSIS_MODEL, inject: [AppConfigService], useFactory: createDiagnosisModel },
    BuildDoctorService,
    BuildDoctorProcessor,
  ],
  exports: [BuildDoctorService],
})
export class BuildDoctorModule {}
