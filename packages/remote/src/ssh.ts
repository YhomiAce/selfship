import { createHash } from 'node:crypto';
import { Client, type ConnectConfig } from 'ssh2';

/** How to reach a server. Exactly one of `privateKey` / `password` must be set. */
export interface SshTarget {
  host: string;
  port: number;
  username: string;
  /** OpenSSH/PEM private key contents (normal operation). */
  privateKey?: string;
  /** Password, only for the one-off "install our key" step. Never stored. */
  password?: string;
  /**
   * Pinned host key fingerprint (`SHA256:…`). When set, a server presenting
   * any other key is refused (possible man-in-the-middle or reinstalled server).
   * When unset (first connection), the key is accepted so it can be pinned.
   */
  expectedFingerprint?: string | null;
  /** Connection timeout in ms (default 20 s). */
  readyTimeoutMs?: number;
}

/** Result of a finished command. */
export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Options for {@link SshConnection.exec}. */
export interface ExecOptions {
  /** Run as root through `sudo -n` (non-interactive). */
  sudo?: boolean;
  /** Data written to stdin, e.g. a script for `bash -s`. */
  stdin?: string;
  /** Called with each chunk of output as it arrives (live logs). */
  onOutput?: (chunk: string, stream: 'stdout' | 'stderr') => void;
  /** Kill the command after this long (default 30 minutes). */
  timeoutMs?: number;
  /** Throw on a non-zero exit code (default true). */
  check?: boolean;
}

/** Anything that can run commands on a server (lets tests use a fake). */
export interface CommandRunner {
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
}

/** A remote command exited with a non-zero code. */
export class RemoteCommandError extends Error {
  override name = 'RemoteCommandError';

  /**
   * @param label - Short description of the command (no secrets)
   * @param code - Exit code
   * @param output - stderr (or stdout) of the command
   */
  constructor(
    label: string,
    readonly code: number,
    readonly output: string,
  ) {
    const tail = output.trim().split('\n').slice(-5).join(' | ');
    super(`${label} failed with exit code ${code}${tail ? `: ${tail}` : ''}`);
  }
}

/** The server presented a different host key than the pinned one. */
export class HostKeyMismatchError extends Error {
  override name = 'HostKeyMismatchError';

  /**
   * @param expected - Pinned fingerprint
   * @param actual - Fingerprint the server presented
   */
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super(
      `The server's identity changed (expected ${expected}, got ${actual}). ` +
        'This happens when a server is reinstalled, but can also mean someone is intercepting the connection.',
    );
  }
}

/**
 * Quotes a value for safe use as one POSIX shell word. Every value placed in
 * a remote command goes through this; nothing is concatenated raw.
 *
 * @param value - Any string
 * @returns The value wrapped in single quotes, embedded quotes escaped
 */
export function sh(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Formats a host key like OpenSSH: `SHA256:` + unpadded base64 of the hash.
 *
 * @param key - Raw host key bytes
 * @returns Fingerprint string
 */
export function fingerprint(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
}

/** One SSH connection, with helpers to run commands and write files. */
export class SshConnection implements CommandRunner {
  private readonly client = new Client();
  private hostFingerprint = '';

  private constructor() {}

  /**
   * Connects and verifies the host key.
   *
   * @param target - Server address, user and credentials
   * @returns An open connection
   * @throws {HostKeyMismatchError} If the host key differs from the pinned one
   * @throws {Error} On network or authentication failure
   */
  static async connect(target: SshTarget): Promise<SshConnection> {
    const connection = new SshConnection();
    const config: ConnectConfig = {
      host: target.host,
      port: target.port,
      username: target.username,
      readyTimeout: target.readyTimeoutMs ?? 20_000,
      keepaliveInterval: 15_000,
      // Never fall back to keyboard-interactive prompts.
      tryKeyboard: false,
      hostVerifier: (key: Buffer): boolean => {
        connection.hostFingerprint = fingerprint(key);
        return (
          !target.expectedFingerprint || target.expectedFingerprint === connection.hostFingerprint
        );
      },
      ...(target.privateKey ? { privateKey: target.privateKey } : {}),
      ...(target.password ? { password: target.password } : {}),
    };

    await new Promise<void>((resolve, reject) => {
      connection.client
        .on('ready', () => {
          resolve();
        })
        .on('error', (error: Error) => {
          // ssh2 reports a rejected host key only as "verification failed".
          if (
            target.expectedFingerprint &&
            connection.hostFingerprint &&
            connection.hostFingerprint !== target.expectedFingerprint
          ) {
            reject(
              new HostKeyMismatchError(target.expectedFingerprint, connection.hostFingerprint),
            );
          } else {
            reject(error);
          }
        })
        .connect(config);
    });
    return connection;
  }

  /** The server's host key fingerprint (pin it after the first connection). */
  get fingerprint(): string {
    return this.hostFingerprint;
  }

  /**
   * Runs a command and waits for it to finish.
   *
   * @param command - Shell command (quote values with {@link sh})
   * @param options - See {@link ExecOptions}
   * @returns Exit code and collected output
   * @throws {RemoteCommandError} For non-zero exit codes (unless `check: false`)
   */
  exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    const full = options.sudo ? `sudo -n bash -c ${sh(command)}` : command;
    const timeoutMs = options.timeoutMs ?? 30 * 60 * 1000;
    const label = command.split('\n')[0]?.slice(0, 80) ?? 'command';

    return new Promise<ExecResult>((resolve, reject) => {
      this.client.exec(full, (error, stream) => {
        if (error) {
          reject(error);
          return;
        }
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
          stream.close();
          reject(new Error(`Command timed out after ${Math.round(timeoutMs / 1000)}s: ${label}`));
        }, timeoutMs);

        stream.on('data', (data: Buffer) => {
          const text = data.toString();
          stdout += text;
          options.onOutput?.(text, 'stdout');
        });
        stream.stderr.on('data', (data: Buffer) => {
          const text = data.toString();
          stderr += text;
          options.onOutput?.(text, 'stderr');
        });
        stream.on('close', (code: number | null) => {
          clearTimeout(timer);
          const result = { code: code ?? -1, stdout, stderr };
          if ((options.check ?? true) && result.code !== 0) {
            reject(new RemoteCommandError(label, result.code, stderr || stdout));
          } else {
            resolve(result);
          }
        });
        if (options.stdin !== undefined) stream.end(options.stdin);
      });
    });
  }

  /**
   * Writes a file as root through stdin (works with sudo, no SFTP needed).
   *
   * @param path - Absolute remote path
   * @param content - File contents
   * @param mode - Octal permissions, e.g. "600"
   */
  async writeFile(path: string, content: string, mode = '644'): Promise<void> {
    await this.exec(`install -D -m ${sh(mode)} /dev/stdin ${sh(path)}`, {
      sudo: true,
      stdin: content,
    });
  }

  /** Closes the connection. */
  close(): void {
    this.client.end();
  }
}
