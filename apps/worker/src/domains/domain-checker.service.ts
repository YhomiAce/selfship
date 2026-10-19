import { Injectable, Logger } from '@nestjs/common';
import type { Deployment, Domain, Server } from '@selfship/db';
import { checkDomainDns, probeCertificate, sh } from '@selfship/remote';
import { explainCertificateError } from '@selfship/shared';
import { resolveIpv4 } from '../deployments/deployment-plan';
import { PrismaService } from '../prisma/prisma.service';
import { ServerConnector } from '../servers/server-connector';
import { DeploymentLauncher } from './deployment-launcher.service';

/** After this long without a certificate, look into Traefik's log for the reason. */
const CERTIFICATE_PATIENCE_MS = 10 * 60 * 1000;
/** Rows handled per run (the job runs every minute). */
const BATCH = 50;

type DomainWithServer = Domain & { project: { id: string; server: Server | null } };

/**
 * Moves domains through their setup, once a minute:
 *
 * 1. `pending_dns` → `issuing` when the user's DNS record points at the server
 * 2. makes sure verified domains are routed (re-runs the live image if needed)
 * 3. `issuing` → `active` when the server presents a valid certificate, or
 *    `error` with Let's Encrypt's reason when it doesn't after a while
 */
@Injectable()
export class DomainChecker {
  private readonly logger = new Logger(DomainChecker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly launcher: DeploymentLauncher,
    private readonly connector: ServerConnector,
  ) {}

  /** One pass over pending and issuing domains. */
  async check(): Promise<void> {
    await this.verifyDns();
    await this.confirmCertificates();
  }

  /** Step 1: checks the DNS of custom domains waiting for it. */
  private async verifyDns(): Promise<void> {
    const pending = await this.prisma.domain.findMany({
      where: { kind: 'custom', status: 'pending_dns' },
      include: { project: { select: { id: true, server: true } } },
      orderBy: { lastCheckedAt: { sort: 'asc', nulls: 'first' } },
      take: BATCH,
    });
    for (const domain of pending) {
      const now = new Date();
      if (!domain.project.server) {
        await this.update(domain.id, {
          statusMessage: 'Choose a server for this project first.',
          lastCheckedAt: now,
        });
        continue;
      }
      try {
        const result = await checkDomainDns(
          domain.hostname,
          await resolveIpv4(domain.project.server.host),
        );
        await this.update(
          domain.id,
          result.ok
            ? { status: 'issuing', verifiedAt: now, statusMessage: null, lastCheckedAt: now }
            : { statusMessage: result.message, lastCheckedAt: now },
        );
      } catch (error) {
        this.logger.warn(`DNS check of ${domain.hostname} failed: ${String(error)}`);
      }
    }
  }

  /** Steps 2 and 3, per project. */
  private async confirmCertificates(): Promise<void> {
    const domains: DomainWithServer[] = await this.prisma.domain.findMany({
      where: { status: { in: ['issuing', 'error'] }, verifiedAt: { not: null } },
      include: { project: { select: { id: true, server: true } } },
      orderBy: { lastCheckedAt: { sort: 'asc', nulls: 'first' } },
      take: BATCH,
    });
    const byProject = new Map<string, DomainWithServer[]>();
    for (const domain of domains) {
      byProject.set(domain.projectId, [...(byProject.get(domain.projectId) ?? []), domain]);
    }
    for (const [projectId, projectDomains] of byProject) {
      try {
        await this.confirmProject(projectId, projectDomains);
      } catch (error) {
        this.logger.warn(`Domain check for project ${projectId} failed: ${String(error)}`);
      }
    }
  }

  private async confirmProject(projectId: string, domains: DomainWithServer[]): Promise<void> {
    const now = new Date();
    const live = await this.prisma.deployment.findFirst({
      where: { projectId, status: 'live' },
      include: { server: true },
    });
    if (!live?.server) {
      for (const d of domains) {
        await this.update(d.id, {
          statusMessage: 'Deploy the project to start using this domain.',
          lastCheckedAt: now,
        });
      }
      return;
    }
    if (this.needsRouting(live, domains)) {
      const queued = await this.launcher.queueConfigRedeploy(projectId);
      for (const d of domains) {
        await this.update(d.id, {
          statusMessage: queued
            ? 'Adding the domain to the app…'
            : 'Waiting for the current deployment to finish…',
          lastCheckedAt: now,
        });
      }
      return;
    }

    const ipv4 = await resolveIpv4(live.server.host);
    for (const domain of domains) {
      const probe = await probeCertificate(ipv4, domain.hostname);
      if (probe.valid) {
        await this.update(domain.id, { status: 'active', statusMessage: null, lastCheckedAt: now });
        this.logger.log(`${domain.hostname} is active`);
        continue;
      }
      const waitingSince = domain.verifiedAt ?? domain.createdAt;
      if (now.getTime() - waitingSince.getTime() < CERTIFICATE_PATIENCE_MS) {
        await this.update(domain.id, {
          statusMessage: "Waiting for Let's Encrypt to issue the certificate…",
          lastCheckedAt: now,
        });
        continue;
      }
      const reason = await this.certificateError(live.server, domain.hostname);
      await this.update(domain.id, {
        status: 'error',
        statusMessage:
          reason ??
          `No valid certificate yet (${probe.reason ?? 'unknown reason'}). Selfship keeps retrying.`,
        lastCheckedAt: now,
      });
    }
  }

  /** A custom domain verified after the live deployment started isn't in its routes yet. */
  private needsRouting(live: Deployment, domains: DomainWithServer[]): boolean {
    const started = live.startedAt ?? live.createdAt;
    return domains.some(
      (d) => d.kind === 'custom' && d.verifiedAt !== null && d.verifiedAt > started,
    );
  }

  /** Let's Encrypt's complaint about a domain, from Traefik's log, in plain words. */
  private async certificateError(server: Server, hostname: string): Promise<string | null> {
    try {
      const { ssh } = await this.connector.connect(server);
      try {
        const { stdout } = await ssh.exec(
          `docker logs --since 2h selfship-traefik 2>&1 | grep -F -- ${sh(hostname)} | tail -n 5`,
          { sudo: true, check: false, timeoutMs: 30_000 },
        );
        const hint = explainCertificateError(stdout);
        return hint ? `${hint.title}. ${hint.advice}` : null;
      } finally {
        ssh.close();
      }
    } catch (error) {
      this.logger.warn(`Reading Traefik's log for ${hostname} failed: ${String(error)}`);
      return null;
    }
  }

  private async update(
    id: string,
    data: Partial<Pick<Domain, 'status' | 'statusMessage' | 'verifiedAt' | 'lastCheckedAt'>>,
  ): Promise<void> {
    await this.prisma.domain.updateMany({ where: { id }, data });
  }
}
