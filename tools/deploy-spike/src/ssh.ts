import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ssh2 from 'ssh2';

const { Client } = ssh2;

/** How to reach a server. */
export interface SshTarget {
  host: string;
  port: number;
  username: string;
  /** PEM/OpenSSH private key contents. */
  privateKey: string;
  /**
   * Expected host key fingerprint (`SHA256:…`). When set, connecting to a
   * server presenting a different key fails (possible man-in-the-middle).
   * When unset, the key is accepted and returned so it can be pinned.
   */
  expectedFingerprint?: string;
}

/** Result of a finished command. */
export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Options for {@link SshConnection.exec}. */
export interface ExecOptions {
  /** Run as root through `sudo` (non-interactive). */
  sudo?: boolean;
  /** Data written to the command's stdin, e.g. a script for `bash -s`. */
  stdin?: string;
  /** Called with each chunk of output as it arrives (live logs). */
  onOutput?: (chunk: string, stream: 'stdout' | 'stderr') => void;
  /** Kill the command after this long (default 30 minutes). */
  timeoutMs?: number;
  /** Throw if the exit code isn't 0 (default true). */
  check?: boolean;
}

/** Thrown when a remote command exits with a non-zero code. */
export class RemoteCommandError extends Error {
  override name = 'RemoteCommandError';
  readonly code: number;
  readonly stderr: string;

  constructor(label: string, code: number, stderr: string) {
    super(
      `${label} failed with exit code ${code}${stderr ? `: ${stderr.trim().split('\n').slice(-5).join(' | ')}` : ''}`,
    );
    this.code = code;
    this.stderr = stderr;
  }
}

/**
 * Quotes a value for safe use as a single POSIX shell word. Every value we
 * put into a remote command goes through this; nothing is ever concatenated raw.
 *
 * @param value - Any string
 * @returns The value wrapped in single quotes with embedded quotes escaped
 */
export function sh(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Formats a host key as OpenSSH does: `SHA256:` + unpadded base64 of the hash.
 *
 * @param key - Raw host key bytes
 * @returns Fingerprint string
 */
export function fingerprint(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
}

/**
 * One SSH connection to a server, with helpers for running commands and
 * writing files. Built on `ssh2`.
 */
export class SshConnection {
  private readonly client = new Client();
  private hostFingerprint = '';

  private constructor() {}

  /**
   * Connects and verifies the host key.
   *
   * @param target - Server address, user and key
   * @returns An open connection
   * @throws {Error} On network/auth failure or a host key mismatch
   */
  static async connect(target: SshTarget): Promise<SshConnection> {
    const connection = new SshConnection();
    await new Promise<void>((resolve, reject) => {
      connection.client
        .on('ready', () => {
          resolve();
        })
        .on('error', (error: Error) => {
          reject(error);
        })
        .connect({
          host: target.host,
          port: target.port,
          username: target.username,
          privateKey: target.privateKey,
          readyTimeout: 20_000,
          keepaliveInterval: 15_000,
          hostVerifier: (key: Buffer): boolean => {
            connection.hostFingerprint = fingerprint(key);
            return (
              !target.expectedFingerprint ||
              target.expectedFingerprint === connection.hostFingerprint
            );
          },
        });
    });
    return connection;
  }

  /** The server's host key fingerprint (pin it on first connect). */
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
          reject(
            new Error(`Command timed out after ${timeoutMs / 1000}s: ${command.slice(0, 80)}`),
          );
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
            reject(
              new RemoteCommandError(
                command.split('\n')[0]?.slice(0, 80) ?? 'command',
                result.code,
                stderr || stdout,
              ),
            );
          } else {
            resolve(result);
          }
        });
        if (options.stdin !== undefined) stream.end(options.stdin);
      });
    });
  }

  /**
   * Writes a file as root via stdin (no SFTP needed, works with sudo).
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

/**
 * Reads a private key file, expanding `~`.
 *
 * @param path - Key path
 * @returns Key contents
 */
export function readPrivateKey(path: string): string {
  return readFileSync(path.replace(/^~(?=\/)/, process.env.HOME ?? '~'), 'utf8');
}
