import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Domain } from '@selfship/db';
import type { CloudflareDnsClient } from '@selfship/cloudflare';
import type { Routing } from '@selfship/remote';
import { AppConfigService } from '../config/app-config.service';
import { previewHost } from '../deployments/deployment-plan';
import { PrismaService } from '../prisma/prisma.service';
import { CLOUDFLARE_CLIENT } from './cloudflare.module';

/** Hostnames to route, and the main URL to show. */
export interface ProjectRouting {
  routing: Routing;
  /** Main address: an active custom domain, else the free subdomain, else the temporary URL. */
  url: string;
}

/** A custom domain with the domain it redirects to, if any. */
type CustomDomain = Pick<Domain, 'hostname' | 'status' | 'redirectToId'> & {
  redirectTo: Pick<Domain, 'hostname' | 'status'> | null;
};

/**
 * Turns a project's domains into routes: custom domains that passed DNS
 * verification and the free subdomain are served, redirect domains redirect,
 * and the temporary host always works. The main URL prefers an active custom
 * domain, then the free subdomain, then the temporary host.
 *
 * @param custom - Verified custom domains (any order)
 * @param platform - The free subdomain, if any
 * @param preview - The temporary sslip.io host
 * @returns Routing and main URL
 */
export function buildRouting(
  custom: readonly CustomDomain[],
  platform: Pick<Domain, 'hostname' | 'status'> | null,
  preview: string,
): ProjectRouting {
  const routed = custom.filter((d) => ROUTED.includes(d.status));
  const served = routed.filter((d) => !d.redirectToId);
  const redirects = routed
    .filter((d) => d.redirectTo && ROUTED.includes(d.redirectTo.status))
    .map((d) => ({ from: d.hostname, to: d.redirectTo?.hostname ?? '' }));
  const hosts = [
    ...served.map((d) => d.hostname),
    ...(platform ? [platform.hostname] : []),
    preview,
  ];
  const primary =
    served.find((d) => d.status === 'active')?.hostname ??
    (platform && platform.status !== 'error' ? platform.hostname : null) ??
    preview;
  return { routing: { hosts, redirects }, url: `https://${primary}` };
}

/** Subdomains that could be mistaken for Selfship's own, so projects never get them bare. */
const RESERVED_LABELS = new Set([
  'www',
  'api',
  'app',
  'apps',
  'admin',
  'dashboard',
  'docs',
  'mail',
  'status',
  'selfship',
  'blog',
  'help',
]);

/** Domains currently routed to the app (DNS verified, or our own subdomain). */
const ROUTED: Domain['status'][] = ['issuing', 'active', 'error'];

/**
 * Works out which hostnames reach a project's app, and manages its free
 * subdomain (`<name>.<PLATFORM_APPS_DOMAIN>`) in Cloudflare.
 */
@Injectable()
export class DomainRoutingService {
  private readonly logger = new Logger(DomainRoutingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    @Inject(CLOUDFLARE_CLIENT) private readonly cloudflare: CloudflareDnsClient | null,
  ) {}

  /**
   * Routing for a deployment. On the first deployment the free subdomain is
   * created (DNS record → this server), so its certificate can be issued
   * as soon as the app starts. The temporary sslip.io host is always
   * included, so the app stays reachable even if DNS has trouble.
   *
   * @param project - Project (name and ID)
   * @param serverIpv4 - The server's IPv4 address
   * @param log - Writes a line to the deployment log
   * @returns Hostnames, redirects and the main URL
   */
  async prepare(
    project: { id: string; name: string },
    serverIpv4: string,
    log: (line: string) => void,
  ): Promise<ProjectRouting> {
    const preview = previewHost(
      project.name,
      project.id,
      serverIpv4,
      this.config.get('PREVIEW_DOMAIN'),
    );
    const platform = await this.ensurePlatformDomain(project, serverIpv4, log);
    const domains = await this.prisma.domain.findMany({
      where: { projectId: project.id, kind: 'custom', status: { in: ROUTED } },
      include: { redirectTo: true },
      orderBy: { createdAt: 'asc' },
    });

    const result = buildRouting(domains, platform, preview);
    if (result.routing.hosts.length > 1) log(`→ Routing ${result.routing.hosts.join(', ')}`);
    return result;
  }

  /**
   * After a successful deployment: points the free subdomain at this server
   * if the project has moved here.
   *
   * @param projectId - Project ID
   * @param serverIpv4 - The server now serving the app
   */
  async afterLive(projectId: string, serverIpv4: string): Promise<void> {
    if (!this.cloudflare) return;
    const platform = await this.prisma.domain.findFirst({ where: { projectId, kind: 'platform' } });
    if (!platform || platform.dnsTarget === serverIpv4) return;
    try {
      const record = await this.cloudflare.upsertA(
        platform.hostname,
        serverIpv4,
        `selfship project ${projectId}`,
      );
      await this.prisma.domain.update({
        where: { id: platform.id },
        data: {
          dnsRecordId: record.id,
          dnsTarget: serverIpv4,
          status: 'issuing',
          statusMessage: null,
        },
      });
    } catch (error) {
      this.logger.warn(`Moving ${platform.hostname} to ${serverIpv4} failed: ${String(error)}`);
    }
  }

  /**
   * The project's free subdomain, created on first use. A DNS failure doesn't
   * fail the deployment: the app is still reachable on the temporary URL.
   */
  private async ensurePlatformDomain(
    project: { id: string; name: string },
    serverIpv4: string,
    log: (line: string) => void,
  ): Promise<Domain | null> {
    const appsDomain = this.config.get('PLATFORM_APPS_DOMAIN');
    if (!this.cloudflare || !appsDomain) return null;
    const existing = await this.prisma.domain.findFirst({
      where: { projectId: project.id, kind: 'platform' },
    });
    if (existing?.dnsRecordId) return existing;

    let domain = existing;
    if (!domain) {
      const bare = `${project.name}.${appsDomain}`;
      const candidates = RESERVED_LABELS.has(project.name)
        ? [`${project.name}-${project.id.slice(0, 6)}.${appsDomain}`]
        : [bare, `${project.name}-${project.id.slice(0, 6)}.${appsDomain}`];
      for (const hostname of candidates) {
        const taken = await this.prisma.domain.count({ where: { hostname } });
        if (taken > 0) continue;
        domain = await this.prisma.domain.create({
          data: { projectId: project.id, hostname, kind: 'platform', status: 'issuing' },
        });
        break;
      }
      if (!domain) return null;
    }

    try {
      const record = await this.cloudflare.upsertA(
        domain.hostname,
        serverIpv4,
        `selfship project ${project.id}`,
      );
      log(`✓ Free subdomain ${domain.hostname} → ${serverIpv4}`);
      return await this.prisma.domain.update({
        where: { id: domain.id },
        data: {
          dnsRecordId: record.id,
          dnsTarget: serverIpv4,
          verifiedAt: new Date(),
          status: domain.status === 'active' ? 'active' : 'issuing',
          statusMessage: null,
        },
      });
    } catch (error) {
      log(
        `⚠ Couldn't create the DNS record for ${domain.hostname}; using the temporary URL for now`,
      );
      this.logger.warn(`Cloudflare upsert for ${domain.hostname} failed: ${String(error)}`);
      await this.prisma.domain.update({
        where: { id: domain.id },
        data: {
          status: 'error',
          statusMessage:
            "The DNS record couldn't be created. Selfship will retry on the next deployment.",
        },
      });
      return null;
    }
  }
}
