import { lookup } from 'node:dns/promises';
import { isIPv4 } from 'node:net';
import type { EnvScope } from '@selfship/shared';

/**
 * Encryption context of an env var value. Binds the ciphertext to its
 * project and name, so it can't be moved to another project or variable.
 * Must match the API's `envVarContext` (apps/api/src/env-vars/env-vars.service.ts).
 *
 * @param projectId - Project ID
 * @param key - Variable name
 * @returns Context string
 */
export function envVarContext(projectId: string, key: string): string {
  return `project:${projectId}:env:${key}`;
}

/**
 * Stable, DNS-safe ID of a project's app on servers (container names,
 * Traefik routers, `/opt/selfship/apps/<id>`).
 *
 * @param projectId - Project UUID
 * @returns e.g. `p-1a2b3c4d5e6f`
 */
export function appId(projectId: string): string {
  return `p-${projectId.replace(/-/g, '').slice(0, 12)}`;
}

/**
 * Temporary hostname of a project until it has a custom domain:
 * `<name>-<id>.<ip-with-dashes>.<previewDomain>`. Wildcard DNS services such
 * as sslip.io resolve it to the IP, so Let's Encrypt can issue a certificate.
 *
 * @param projectName - DNS-safe project name
 * @param projectId - Project UUID (keeps names unique on shared servers)
 * @param ipv4 - Server's public IPv4 address
 * @param previewDomain - e.g. `sslip.io`
 * @returns Hostname
 */
export function previewHost(
  projectName: string,
  projectId: string,
  ipv4: string,
  previewDomain: string,
): string {
  return `${projectName}-${projectId.slice(0, 6)}.${ipv4.replace(/\./g, '-')}.${previewDomain}`;
}

/**
 * The server's IPv4 address (servers can be added by hostname).
 *
 * @param host - IP or hostname
 * @returns IPv4 address
 * @throws {Error} If the host has no IPv4 address
 */
export async function resolveIpv4(host: string): Promise<string> {
  if (isIPv4(host)) return host;
  const { address } = await lookup(host, { family: 4 });
  return address;
}

/**
 * Splits decrypted variables by when they're needed. `both` goes to each.
 *
 * @param vars - Variables with their scope
 * @returns Build-time and runtime maps
 */
export function splitEnv(vars: readonly { key: string; value: string; scope: EnvScope }[]): {
  build: Record<string, string>;
  runtime: Record<string, string>;
} {
  const build: Record<string, string> = {};
  const runtime: Record<string, string> = {};
  for (const { key, value, scope } of vars) {
    if (scope !== 'runtime') build[key] = value;
    if (scope !== 'build') runtime[key] = value;
  }
  return { build, runtime };
}
