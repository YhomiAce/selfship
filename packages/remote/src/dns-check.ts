import { lookup, Resolver } from 'node:dns/promises';
import { BlockList, isIPv4 } from 'node:net';

/** Outcome of {@link checkDomainDns}. */
export interface DnsCheckResult {
  /** True when every IPv4 address is the server's and nothing else gets in the way. */
  ok: boolean;
  /** IPv4 addresses the name resolves to (after following CNAMEs). */
  ipv4: string[];
  /** IPv6 addresses (a stray AAAA record breaks certificates). */
  ipv6: string[];
  /** What's wrong, in words users can act on (null when ok). */
  message: string | null;
}

/** The two lookups the check needs (injectable in tests). */
export interface DnsLookups {
  resolve4(hostname: string): Promise<string[]>;
  resolve6(hostname: string): Promise<string[]>;
}

/** Cloudflare proxy ranges: an "orange cloud" record resolves here instead of the server. */
const CLOUDFLARE_PROXY = new BlockList();
for (const [network, prefix] of [
  ['173.245.48.0', 20],
  ['103.21.244.0', 22],
  ['103.22.200.0', 22],
  ['103.31.4.0', 22],
  ['141.101.64.0', 18],
  ['108.162.192.0', 18],
  ['190.93.240.0', 20],
  ['188.114.96.0', 20],
  ['197.234.240.0', 22],
  ['198.41.128.0', 17],
  ['162.158.0.0', 15],
  ['104.16.0.0', 13],
  ['104.24.0.0', 14],
  ['172.64.0.0', 13],
  ['131.0.72.0', 22],
] as const) {
  CLOUDFLARE_PROXY.addSubnet(network, prefix, 'ipv4');
}

/**
 * Public resolvers (fresher than the system's cache, and the same view
 * Let's Encrypt gets).
 *
 * @returns Lookups via Cloudflare and Google DNS
 */
export function publicDns(): DnsLookups {
  const resolver = new Resolver({ timeout: 3_000, tries: 2 });
  resolver.setServers(['1.1.1.1', '8.8.8.8']);
  return {
    resolve4: (hostname) => resolver.resolve4(hostname),
    resolve6: (hostname) => resolver.resolve6(hostname),
  };
}

/**
 * Checks that a domain points at the server, and explains what to fix if not.
 *
 * @param hostname - Domain, e.g. `app.example.com`
 * @param serverIpv4 - The server's public IPv4 address
 * @param lookups - DNS lookups (defaults to public resolvers)
 * @returns Addresses found and whether they're right
 */
export async function checkDomainDns(
  hostname: string,
  serverIpv4: string,
  lookups: DnsLookups = publicDns(),
): Promise<DnsCheckResult> {
  const [ipv4, ipv6] = await Promise.all([
    lookups.resolve4(hostname).catch(() => []),
    lookups.resolve6(hostname).catch(() => []),
  ]);
  const result = (message: string | null): DnsCheckResult => ({
    ok: message === null,
    ipv4,
    ipv6,
    message,
  });

  if (ipv4.length === 0) {
    return result(
      `No A record found for ${hostname} yet. Create an A record pointing to ${serverIpv4}. New records can take a few minutes to appear.`,
    );
  }
  const others = ipv4.filter((ip) => ip !== serverIpv4);
  if (others.length === ipv4.length) {
    const proxied = others.some((ip) => CLOUDFLARE_PROXY.check(ip, 'ipv4'));
    return result(
      proxied
        ? `${hostname} goes through Cloudflare's proxy (${others.join(', ')}). In Cloudflare, set the record to "DNS only" (grey cloud) so it points straight to ${serverIpv4}.`
        : `${hostname} points to ${others.join(', ')}, not your server (${serverIpv4}). Change the A record to ${serverIpv4}.`,
    );
  }
  if (others.length > 0) {
    return result(
      `${hostname} also points to ${others.join(', ')}. Remove those records so every visitor reaches your server (${serverIpv4}).`,
    );
  }
  if (ipv6.length > 0) {
    return result(
      `${hostname} has an IPv6 (AAAA) record (${ipv6.join(', ')}) that doesn't lead to your server. Remove it: Let's Encrypt and many visitors would use it.`,
    );
  }
  return result(null);
}

/**
 * A server's IPv4 address (servers can be added by hostname).
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
