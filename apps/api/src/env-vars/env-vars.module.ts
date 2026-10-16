import { Module } from '@nestjs/common';
import { EnvVarsController } from './env-vars.controller';
import { EnvVarsService } from './env-vars.service';

/** Project environment variables (encrypted at rest). */
@Module({
  controllers: [EnvVarsController],
  providers: [EnvVarsService],
})
export class EnvVarsModule {}
