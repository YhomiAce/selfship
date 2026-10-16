import { Injectable } from '@nestjs/common';
import type { Server } from '@selfship/db';
import { EnvelopeCipher } from '@selfship/crypto';
import { assertPublicHost, SshConnection } from '@selfship/remote';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Encryption context of a server's private key.
 * Must match the API's `sshKeyContext` (apps/api/src/servers/servers.service.ts).
 *
 * @param serverId - Server ID
 * @returns Encryption context of the server's private key
 */
export function sshKeyContext(serverId: string): string {
  return `server:${serverId}:ssh-key`;
}

/** An open connection, and whether this was the first contact (host key just pinned). */
export interface ServerConnection {
  ssh: SshConnection;
  pinnedNow: boolean;
}

/**
 * Opens SSH connections to users' servers: re-checks the host isn't private
 * (DNS can change after it was added), decrypts the stored key only for the
 * connection, and pins the host key on first contact.
 */
@Injectable()
export class ServerConnector {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: EnvelopeCipher,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Connects to a server.
   *
   * @param server - Server record
   * @returns Connection (caller closes it)
   * @throws {ForbiddenHostError} If the host now resolves to a private address
   * @throws {HostKeyMismatchError} If the pinned host key changed
   * @throws {DecryptionError} If the stored key can't be decrypted
   */
  async connect(server: Server): Promise<ServerConnection> {
    await assertPublicHost(server.host, {
      allowPrivate: this.config.get('ALLOW_PRIVATE_SERVER_HOSTS'),
    });
    const ssh = await SshConnection.connect({
      host: server.host,
      port: server.port,
      username: server.sshUser,
      privateKey: this.cipher.decrypt(server.encryptedPrivateKey, sshKeyContext(server.id)),
      expectedFingerprint: server.hostKeyFingerprint,
    });
    if (server.hostKeyFingerprint) return { ssh, pinnedNow: false };
    await this.prisma.server.update({
      where: { id: server.id },
      data: { hostKeyFingerprint: ssh.fingerprint },
    });
    return { ssh, pinnedNow: true };
  }
}
