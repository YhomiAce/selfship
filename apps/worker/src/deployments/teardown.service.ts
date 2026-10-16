import { Injectable, Logger } from '@nestjs/common';
import { teardownApp } from '@selfship/remote';
import { PrismaService } from '../prisma/prisma.service';
import { ServerConnector } from '../servers/server-connector';
import { appId } from './deployment-plan';

/** Removes a project's app from a server (project deleted, or moved to another server). */
@Injectable()
export class TeardownService {
  private readonly logger = new Logger(TeardownService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connector: ServerConnector,
  ) {}

  /**
   * Stops and removes the app's containers, images and files on the server.
   *
   * @param projectId - Project ID (the project may already be deleted)
   * @param serverId - Server ID
   * @throws {Error} On connection failure, so BullMQ retries with backoff
   */
  async teardown(projectId: string, serverId: string): Promise<void> {
    const server = await this.prisma.server.findUnique({ where: { id: serverId } });
    if (!server) return; // removed from Selfship: nothing we may touch any more
    const { ssh } = await this.connector.connect(server);
    try {
      const removed = await teardownApp(ssh, appId(projectId));
      this.logger.log(
        `Removed app ${appId(projectId)} from ${server.name}${removed.length ? ` (${removed.join(', ')})` : ''}`,
      );
    } finally {
      ssh.close();
    }
  }
}
