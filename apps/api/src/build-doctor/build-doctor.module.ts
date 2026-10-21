import { Module } from '@nestjs/common';
import { BuildDoctorController } from './build-doctor.controller';
import { BuildDoctorService } from './build-doctor.service';

/** Build Doctor endpoints (the worker produces the diagnoses). */
@Module({
  controllers: [BuildDoctorController],
  providers: [BuildDoctorService],
})
export class BuildDoctorModule {}
