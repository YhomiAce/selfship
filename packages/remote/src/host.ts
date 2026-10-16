import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/** The host is invalid or resolves to an address we refuse to connect to. */
export class ForbiddenHostError extends Error {
  override name = 'ForbiddenHostError';
}

/**
 * Address ranges that must never be targets: our own machine, private
 * networks (our infrastructure), cloud metadata, CGNAT, multicast…
 * Connecting there on a user's behalf would be server-side request forgery.
 */
const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  BLOCKED.addSubnet(net, prefix, 'ipv6');
}

/** Hostnames: letters, digits, dashes and dots (no ports, paths or spaces). */
const HOSTNAME =
  /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

/**
 * Whether an IP address is in a blocked range (IPv4-mapped IPv6 included).
 *
 * @param address - IPv4 or IPv6 address
 * @returns True if connecting there is not allowed
 */
export function isBlockedAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped?.[1]) return BLOCKED.check(mapped[1], 'ipv4');
  const family = isIP(address);
  if (family === 0) return true;
  return BLOCKED.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Resolves a user-supplied host and refuses private, loopback, link-local and
 * other internal addresses. Called when a server is added **and** right before
 * every connection, because DNS can change in between.
 *
 * @param host - Hostname or IP address
 * @param options.allowPrivate - Allow internal addresses (local development only)
 * @returns The resolved addresses
 * @throws {ForbiddenHostError} If the host is malformed, doesn't resolve, or any address is blocked
 */
export async function assertPublicHost(
  host: string,
  options: { allowPrivate?: boolean } = {},
): Promise<string[]> {
  const value = host.trim();
  if (!isIP(value) && !HOSTNAME.test(value)) {
    throw new ForbiddenHostError('Enter an IP address or a hostname like server.example.com.');
  }

  let addresses: string[];
  try {
    addresses = isIP(value)
      ? [value]
      : (await lookup(value, { all: true, verbatim: true })).map((entry) => entry.address);
  } catch {
    throw new ForbiddenHostError(
      `"${value}" doesn't resolve to an IP address. Check the hostname.`,
    );
  }

  if (!options.allowPrivate) {
    const blocked = addresses.filter(isBlockedAddress);
    if (blocked.length > 0) {
      throw new ForbiddenHostError(
        `"${value}" points to a private or reserved address (${blocked.join(', ')}). Use the server's public IP address.`,
      );
    }
  }
  return addresses;
}
