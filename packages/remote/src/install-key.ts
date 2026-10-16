import { SshConnection, sh } from './ssh';

/** Options for {@link installKeyWithPassword}. */
export interface InstallKeyOptions {
  host: string;
  port: number;
  username: string;
  /** Used for this one connection only. Never logged, stored or queued. */
  password: string;
  /** `authorized_keys` line to add. */
  publicKey: string;
}

/**
 * Logs in **once** with a password and appends our public key to the user's
 * `authorized_keys` (only if it isn't there already). From then on Selfship
 * uses the key; the password is dropped as soon as this returns.
 *
 * @param options - Connection details, password and key
 * @returns The server's host key fingerprint, to pin for later connections
 * @throws {Error} On wrong password, network errors or permission problems
 */
export async function installKeyWithPassword(options: InstallKeyOptions): Promise<string> {
  if (/[\r\n]/.test(options.publicKey)) throw new Error('Invalid public key');
  const ssh = await SshConnection.connect({
    host: options.host,
    port: options.port,
    username: options.username,
    password: options.password,
    readyTimeoutMs: 15_000,
  });
  try {
    await ssh.exec(
      [
        'umask 077',
        'mkdir -p ~/.ssh',
        'touch ~/.ssh/authorized_keys',
        `grep -qxF ${sh(options.publicKey)} ~/.ssh/authorized_keys || echo ${sh(options.publicKey)} >> ~/.ssh/authorized_keys`,
        'chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys',
      ].join(' && '),
      { timeoutMs: 30_000 },
    );
    return ssh.fingerprint;
  } finally {
    ssh.close();
  }
}

/**
 * The command users run themselves to authorise our key (generated-key option).
 *
 * @param publicKey - `authorized_keys` line
 * @returns A one-line shell command
 */
export function authorizeKeyCommand(publicKey: string): string {
  return `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo ${sh(publicKey)} >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`;
}

/**
 * The command users run to revoke our access later.
 *
 * @param keyComment - Comment on our key line, e.g. "selfship-3f2a9c1e"
 * @returns A one-line shell command
 */
export function revokeKeyCommand(keyComment: string): string {
  if (!/^[\w.-]+$/.test(keyComment)) throw new Error('Invalid key comment');
  return `sed -i '/ ${keyComment}$/d' ~/.ssh/authorized_keys`;
}
