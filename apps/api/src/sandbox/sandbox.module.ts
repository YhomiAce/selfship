import { Module } from '@nestjs/common';
import { SandboxController } from './sandbox.controller';
import { SandboxService } from './sandbox.service';

/** The free sandbox (platform-owned servers for trying Selfship). */
@Module({
  controllers: [SandboxController],
  providers: [SandboxService],
  exports: [SandboxService],
})
export class SandboxModule {}
