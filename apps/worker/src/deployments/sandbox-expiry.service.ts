import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TeardownService } from './teardown.service';

/**
 * Removes free sandbox apps whose time is up. The project stays (with its
 * history, env vars and domains); it just no longer has a server, so the
 * user can move it to their own.
 */
@Injectable()
export class SandboxExpiryService {
  private readonly logger = new Logger(SandboxExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly teardown: TeardownService,
  ) {}

  /**
   * Tears down every expired sandbox app.
   *
   * @returns How many apps were removed
   */
  async expire(): Promise<number> {
    const expired = await this.prisma.project.findMany({
      where: { sandboxExpiresAt: { lt: new Date() }, server: { isPlatformSandbox: true } },
      select: { id: true, name: true, serverId: true },
    });
    let removed = 0;
    for (const project of expired) {
      if (!project.serverId) continue;
      try {
        await this.teardown.teardown(project.id, project.serverId);
        await this.prisma.$transaction([
          this.prisma.deployment.updateMany({
            where: { projectId: project.id, status: 'live' },
            data: { status: 'replaced' },
          }),
          this.prisma.project.update({ where: { id: project.id }, data: { serverId: null } }),
        ]);
        removed++;
        this.logger.log(
          `Sandbox app of project ${project.name} (${project.id}) expired and was removed`,
        );
      } catch (error) {
        this.logger.warn(
          `Removing expired sandbox app ${project.id} failed (will retry): ${String(error)}`,
        );
      }
    }
    return removed;
  }
}
