import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type { User } from '@selfship/db';
import type { ProjectSandbox, SandboxStatus } from '@selfship/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SandboxService } from './sandbox.service';

/** The free sandbox. */
@Controller()
export class SandboxController {
  constructor(private readonly sandbox: SandboxService) {}

  /**
   * Whether the signed-in user can use the free sandbox.
   *
   * @returns Availability, eligibility and the server to choose
   */
  @Get('sandbox')
  status(@CurrentUser() user: User): Promise<SandboxStatus> {
    return this.sandbox.status(user.id);
  }

  /**
   * Extends a sandbox app by another week (once).
   *
   * @param projectId - Project on the sandbox
   * @returns New sandbox facts
   */
  @Post('projects/:projectId/sandbox/extend')
  @HttpCode(HttpStatus.OK)
  extend(
    @CurrentUser() user: User,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ProjectSandbox> {
    return this.sandbox.extend(user.id, projectId);
  }
}
