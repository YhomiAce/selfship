import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type CommandRunner, sh } from './ssh';

/** Options for {@link bootstrapServer}. */
export interface BootstrapOptions {
  /** SSH port, opened in the firewall before it's enabled. */
  sshPort: number;
  /** Optional Let's Encrypt account email. */
  acmeEmail?: string;
  /** Use Let's Encrypt staging (no rate limits; untrusted certificates). */
  acmeStaging?: boolean;
  /** Receives every output line (live logs). */
  onLine?: (line: string) => void;
}

/**
 * The bootstrap shell script. Kept as a real `.sh` file (readable,
 * shellcheck-able) and loaded at runtime; `scripts/` ships with the package.
 */
export const BOOTSTRAP_SCRIPT = readFileSync(
  path.join(__dirname, '..', 'scripts', 'bootstrap.sh'),
  'utf8',
);

/**
 * Runs the idempotent bootstrap: Docker, swap, firewall, automatic security
 * updates, and Traefik with Let's Encrypt. Safe to run again at any time.
 *
 * @param runner - Connection to the server (user with passwordless sudo)
 * @param options - See {@link BootstrapOptions}
 * @throws {RemoteCommandError} If the script fails (its output says where)
 */
export async function bootstrapServer(
  runner: CommandRunner,
  options: BootstrapOptions,
): Promise<void> {
  if (!Number.isInteger(options.sshPort) || options.sshPort < 1 || options.sshPort > 65535) {
    throw new Error(`Invalid SSH port: ${options.sshPort}`);
  }
  let buffer = '';
  const env = [
    `SSH_PORT=${options.sshPort}`,
    `ACME_EMAIL=${sh(options.acmeEmail ?? '')}`,
    `ACME_STAGING=${options.acmeStaging ? 1 : 0}`,
  ].join(' ');

  await runner.exec(`${env} bash -s`, {
    sudo: true,
    stdin: BOOTSTRAP_SCRIPT,
    timeoutMs: 20 * 60_000,
    onOutput: (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) options.onLine?.(line);
    },
  });
  if (buffer.trim()) options.onLine?.(buffer);
}
