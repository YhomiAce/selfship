import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Domain, Server } from '@selfship/db';
import type { CloudflareDnsClient } from '@selfship/cloudflare';
import { checkDomainDns, probeCertificate, resolveIpv4 } from '@selfship/remote';
import {
  type AddDomainInput,
  type DnsRecordInstruction,
  type DomainDto,
  DomainErrorCode,
  ErrorCode,
  SandboxErrorCode,
} from '@selfship/shared';
import { isUniqueViolation } from '../common/prisma-errors';
import { AppConfigService } from '../config/app-config.service';
import { DeploymentsService } from '../deployments/deployments.service';
import { PrismaService } from '../prisma/prisma.service';
import { CLOUDFLARE_CLIENT } from './cloudflare.provider';

const PROJECT_NOT_FOUND = { code: ErrorCode.NOT_FOUND, message: 'Project not found.' };
const DOMAIN_NOT_FOUND = { code: ErrorCode.NOT_FOUND, message: 'Domain not found.' };

/** Statuses of a domain that's in the app's routes. */
const ROUTED: Domain['status'][] = ['issuing', 'active', 'error'];

type DomainWithTarget = Domain & { redirectTo: Pick<Domain, 'hostname'> | null };

/**
 * Domains of a project: the free subdomain (created by the worker at the
 * first deployment) and custom domains users add. The worker's domain
 * checker moves custom domains along (DNS → route → certificate); "Check
 * now" here runs the same steps immediately.
 */
@Injectable()
export class DomainsService {
  private readonly logger = new Logger(DomainsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly deployments: DeploymentsService,
    @Inject(CLOUDFLARE_CLIENT) private readonly cloudflare: CloudflareDnsClient | null,
  ) {}

  /**
   * Lists a project's domains with the DNS records to create.
   *
   * @param userId - Signed-in user
   * @param projectId - Project ID
   * @returns Free subdomain first, then custom domains by age
   */
  async list(userId: string, projectId: string): Promise<DomainDto[]> {
    const project = await this.findProject(userId, projectId);
    const domains = await this.prisma.domain.findMany({
      where: { projectId },
      include: { redirectTo: { select: { hostname: true } } },
      orderBy: [{ kind: 'desc' }, { createdAt: 'asc' }],
    });
    const ip = await this.serverIp(project.server);
    return domains.map((domain) => toDomainDto(domain, ip));
  }

  /**
   * Adds a custom domain (and optionally its www/bare twin, redirecting to
   * it), then checks its DNS right away.
   *
   * @param userId - Signed-in user
   * @param projectId - Project ID
   * @param input - Hostname and www option
   * @returns The added domain(s)
   * @throws {BadRequestException} `DOMAIN_RESERVED`
   * @throws {ConflictException} `DOMAIN_TAKEN`
   */
  async add(userId: string, projectId: string, input: AddDomainInput): Promise<DomainDto[]> {
    const project = await this.findProject(userId, projectId);
    const twin = input.withWww
      ? input.hostname.startsWith('www.')
        ? input.hostname.slice(4)
        : `www.${input.hostname}`
      : null;
    if (project.server?.isPlatformSandbox) {
      throw new BadRequestException({
        code: SandboxErrorCode.SANDBOX_CUSTOM_DOMAIN,
        message:
          'Apps on the free sandbox use their free subdomain. Move the project to your own server to add a domain.',
      });
    }
    for (const hostname of [input.hostname, ...(twin ? [twin] : [])]) this.assertAllowed(hostname);

    let created: Domain[];
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const main = await tx.domain.create({
          data: { projectId, hostname: input.hostname, kind: 'custom' },
        });
        if (!twin) return [main];
        const other = await tx.domain.create({
          data: { projectId, hostname: twin, kind: 'custom', redirectToId: main.id },
        });
        return [main, other];
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          code: DomainErrorCode.DOMAIN_TAKEN,
          message: 'That domain is already used by a Selfship project.',
          fieldErrors: { hostname: ['That domain is already used by a Selfship project.'] },
        });
      }
      throw error;
    }

    const ip = await this.serverIp(project.server);
    if (ip) await this.checkDns(projectId, created, ip);
    return this.list(userId, projectId);
  }

  /**
   * "Check now": DNS for domains waiting for it, the certificate for routed ones.
   *
   * @param userId - Signed-in user
   * @param projectId - Project ID
   * @param domainId - Domain ID
   * @returns The domain after the check
   */
  async check(userId: string, projectId: string, domainId: string): Promise<DomainDto> {
    const project = await this.findProject(userId, projectId);
    const domain = await this.findDomain(projectId, domainId);
    const ip = await this.serverIp(project.server);
    if (!ip) {
      throw new BadRequestException({
        code: 'NO_SERVER',
        message: 'Choose a server for this project first.',
      });
    }
    if (domain.status === 'pending_dns') {
      await this.checkDns(projectId, [domain], ip);
    } else if (ROUTED.includes(domain.status)) {
      const probe = await probeCertificate(ip, domain.hostname);
      if (probe.valid) {
        await this.prisma.domain.update({
          where: { id: domain.id },
          data: { status: 'active', statusMessage: null, lastCheckedAt: new Date() },
        });
      }
    }
    return toDomainDto(await this.findDomain(projectId, domainId), ip);
  }

  /**
   * Removes a custom domain (and the domains redirecting to it). If it was
   * routed, the live app is re-run without it.
   *
   * @param userId - Signed-in user
   * @param projectId - Project ID
   * @param domainId - Domain ID
   * @throws {ConflictException} `PLATFORM_DOMAIN_LOCKED` for the free subdomain
   */
  async remove(userId: string, projectId: string, domainId: string): Promise<void> {
    await this.findProject(userId, projectId);
    const domain = await this.findDomain(projectId, domainId);
    if (domain.kind === 'platform') {
      throw new ConflictException({
        code: DomainErrorCode.PLATFORM_DOMAIN_LOCKED,
        message: "The free subdomain can't be removed; it goes away with the project.",
      });
    }
    const removed = await this.prisma.domain.findMany({
      where: { OR: [{ id: domain.id }, { redirectToId: domain.id }] },
    });
    await this.prisma.domain.deleteMany({ where: { id: { in: removed.map((d) => d.id) } } });
    if (removed.some((d) => ROUTED.includes(d.status))) {
      await this.deployments.queueConfigRedeploy(projectId);
    }
  }

  /**
   * Deletes the DNS records of a project's free subdomain (before the
   * project is deleted). Failures are logged, not thrown: a leftover record
   * pointing at the user's server is harmless and can be removed by hand.
   *
   * @param projectId - Project ID
   */
  async removeDnsRecords(projectId: string): Promise<void> {
    if (!this.cloudflare) return;
    const platform = await this.prisma.domain.findMany({
      where: { projectId, kind: 'platform', dnsRecordId: { not: null } },
    });
    for (const domain of platform) {
      try {
        if (domain.dnsRecordId) await this.cloudflare.delete(domain.dnsRecordId);
      } catch (error) {
        this.logger.warn(`Deleting the DNS record of ${domain.hostname} failed: ${String(error)}`);
      }
    }
  }

  /** Checks DNS and moves verified domains to `issuing`; their routing follows right away. */
  private async checkDns(projectId: string, domains: Domain[], ip: string): Promise<void> {
    let verified = false;
    for (const domain of domains) {
      const result = await checkDomainDns(domain.hostname, ip);
      const now = new Date();
      await this.prisma.domain.update({
        where: { id: domain.id },
        data: result.ok
          ? { status: 'issuing', verifiedAt: now, statusMessage: null, lastCheckedAt: now }
          : { statusMessage: result.message, lastCheckedAt: now },
      });
      verified ||= result.ok;
    }
    if (verified) await this.deployments.queueConfigRedeploy(projectId);
  }

  /** Refuses our own domains (free subdomains, temporary URLs, Selfship's sites). */
  private assertAllowed(hostname: string): void {
    const reserved = [
      this.config.get('PLATFORM_APPS_DOMAIN'),
      this.config.get('PREVIEW_DOMAIN'),
      ...this.config.get('RESERVED_DOMAINS').split(','),
    ]
      .map((value) => value?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value));
    if (reserved.some((r) => hostname === r || hostname.endsWith(`.${r}`))) {
      throw new BadRequestException({
        code: DomainErrorCode.DOMAIN_RESERVED,
        message: `${hostname} belongs to Selfship. Add a domain you own.`,
        fieldErrors: { hostname: ['Add a domain you own.'] },
      });
    }
  }

  private async findProject(userId: string, projectId: string): Promise<{ server: Server | null }> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { server: true },
    });
    if (!project) throw new NotFoundException(PROJECT_NOT_FOUND);
    return project;
  }

  private async findDomain(projectId: string, domainId: string): Promise<DomainWithTarget> {
    const domain = await this.prisma.domain.findFirst({
      where: { id: domainId, projectId },
      include: { redirectTo: { select: { hostname: true } } },
    });
    if (!domain) throw new NotFoundException(DOMAIN_NOT_FOUND);
    return domain;
  }

  /** The server's IPv4 (null without a server, or if it can't be resolved). */
  private async serverIp(server: Server | null): Promise<string | null> {
    if (!server) return null;
    return resolveIpv4(server.host).catch(() => null);
  }
}

/**
 * Public shape of a domain, with the DNS record users must create.
 *
 * @param domain - Domain with its redirect target
 * @param serverIp - The project's server IP (null when it has none)
 * @returns DTO
 */
export function toDomainDto(domain: DomainWithTarget, serverIp: string | null): DomainDto {
  const dnsRecords: DnsRecordInstruction[] =
    domain.kind === 'custom' && serverIp
      ? [{ type: 'A', name: domain.hostname, value: serverIp }]
      : [];
  return {
    id: domain.id,
    hostname: domain.hostname,
    kind: domain.kind,
    status: domain.status,
    statusMessage: domain.statusMessage,
    redirectTo: domain.redirectTo?.hostname ?? null,
    dnsRecords,
    verifiedAt: domain.verifiedAt?.toISOString() ?? null,
    lastCheckedAt: domain.lastCheckedAt?.toISOString() ?? null,
    createdAt: domain.createdAt.toISOString(),
  };
}
