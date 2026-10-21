import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Project, Server } from '@selfship/db';
import {
  type AdapterName,
  ADAPTER_LABELS,
  ErrorCode,
  type ProjectSandbox,
  SANDBOX_ADAPTERS,
  SANDBOX_DAYS,
  SandboxErrorCode,
  type SandboxStatus,
} from '@selfship/shared';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The free sandbox: platform-owned servers where verified users can try
 * Selfship with one small app for {@link SANDBOX_DAYS} days.
 */
@Injectable()
export class SandboxService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Whether the user can put a project on the sandbox, and which server.
   *
   * @param userId - Signed-in user
   * @returns Availability, eligibility (with the reason) and the server to use
   */
  async status(userId: string): Promise<SandboxStatus> {
    const [server, user, current] = await Promise.all([
      this.pickServer(),
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { emailVerifiedAt: true },
      }),
      this.prisma.project.findFirst({
        where: { userId, server: { isPlatformSandbox: true } },
        select: { id: true },
      }),
    ]);
    const reason = !server
      ? 'The free sandbox is not available right now.'
      : !user.emailVerifiedAt
        ? 'Confirm your email address to use the free sandbox.'
        : current
          ? 'You already have a project on the free sandbox (one at a time).'
          : null;
    return {
      available: server !== null,
      eligible: reason === null,
      reason,
      projectId: current?.id ?? null,
      serverId: server?.id ?? null,
    };
  }

  /**
   * Checks a project may move to the sandbox and returns its expiry.
   *
   * @param userId - Owner
   * @param project - Project (its current sandbox history counts)
   * @param adapter - Project type it will have
   * @returns When the sandbox app will expire
   * @throws {BadRequestException} `SANDBOX_NOT_ELIGIBLE` / `SANDBOX_ADAPTER`
   */
  async join(userId: string, project: Project, adapter: AdapterName): Promise<Date> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { emailVerifiedAt: true },
    });
    const refuse = (code: string, message: string): never => {
      throw new BadRequestException({ code, message, fieldErrors: { serverId: [message] } });
    };
    if (!user.emailVerifiedAt)
      refuse(
        SandboxErrorCode.SANDBOX_NOT_ELIGIBLE,
        'Confirm your email address to use the free sandbox.',
      );
    if (!SANDBOX_ADAPTERS.includes(adapter)) {
      refuse(
        SandboxErrorCode.SANDBOX_ADAPTER,
        `${ADAPTER_LABELS[adapter].split(' (')[0]} projects need your own server; the free sandbox runs static sites, single-page apps and small Node.js servers.`,
      );
    }
    const other = await this.prisma.project.count({
      where: { userId, id: { not: project.id }, server: { isPlatformSandbox: true } },
    });
    if (other > 0)
      refuse(
        SandboxErrorCode.SANDBOX_NOT_ELIGIBLE,
        'You already have a project on the free sandbox (one at a time).',
      );
    const customDomains = await this.prisma.domain.count({
      where: { projectId: project.id, kind: 'custom' },
    });
    if (customDomains > 0)
      refuse(
        SandboxErrorCode.SANDBOX_CUSTOM_DOMAIN,
        'Remove the custom domains first: sandbox apps use their free subdomain only.',
      );
    if (project.sandboxExpiresAt && project.sandboxExpiresAt < new Date()) {
      refuse(
        SandboxErrorCode.SANDBOX_NOT_ELIGIBLE,
        "This project's free sandbox time is over. Move it to your own server.",
      );
    }
    return project.sandboxExpiresAt ?? new Date(Date.now() + SANDBOX_DAYS * DAY_MS);
  }

  /**
   * Gives a sandbox app {@link SANDBOX_DAYS} more days, once.
   *
   * @param userId - Owner
   * @param projectId - Project on the sandbox
   * @returns The new sandbox facts
   * @throws {ConflictException} `SANDBOX_ALREADY_EXTENDED`
   */
  async extend(userId: string, projectId: string): Promise<ProjectSandbox> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId, server: { isPlatformSandbox: true } },
    });
    if (!project?.sandboxExpiresAt) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'This project is not on the free sandbox.',
      });
    }
    if (project.sandboxExtended) {
      throw new ConflictException({
        code: SandboxErrorCode.SANDBOX_ALREADY_EXTENDED,
        message:
          'The sandbox can be extended once. Move the project to your own server to keep it running.',
      });
    }
    const updated = await this.prisma.project.update({
      where: { id: project.id },
      data: {
        sandboxExpiresAt: new Date(project.sandboxExpiresAt.getTime() + SANDBOX_DAYS * DAY_MS),
        sandboxExtended: true,
      },
    });
    const facts = sandboxFacts(updated, true);
    if (!facts) throw new Error('Sandbox expiry missing after extending');
    return facts;
  }

  /** The ready sandbox server with the fewest projects. */
  private async pickServer(): Promise<Server | null> {
    const servers = await this.prisma.server.findMany({
      where: { isPlatformSandbox: true, status: 'ready' },
      include: { _count: { select: { projects: true } } },
    });
    servers.sort((a, b) => a._count.projects - b._count.projects);
    return servers[0] ?? null;
  }
}

/**
 * Sandbox facts for a project's DTO: shown while it's on the sandbox, and
 * after it expired (until it moves to another server).
 *
 * @param project - Project row
 * @param onSandbox - Its server is a sandbox server
 * @returns Facts, or null when the project has nothing to do with the sandbox
 */
export function sandboxFacts(
  project: Pick<Project, 'sandboxExpiresAt' | 'sandboxExtended' | 'serverId'>,
  onSandbox: boolean,
): ProjectSandbox | null {
  if (!project.sandboxExpiresAt) return null;
  const expired = project.sandboxExpiresAt < new Date();
  if (!onSandbox && !(expired && !project.serverId)) return null;
  return {
    expiresAt: project.sandboxExpiresAt.toISOString(),
    extended: project.sandboxExtended,
    expired,
  };
}
