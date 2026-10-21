import { execFileSync } from 'node:child_process';
import { ensureSwap, pruneDocker } from './maintenance';
import type { CommandRunner, ExecOptions, ExecResult } from './ssh';

/** Runner that answers with fixed output and records the script. */
function runner(stdout: string): CommandRunner & { scripts: string[] } {
  const scripts: string[] = [];
  return {
    scripts,
    exec(command: string, options?: ExecOptions): Promise<ExecResult> {
      scripts.push(command);
      expect(options?.sudo).toBe(true);
      return Promise.resolve({ code: 0, stdout, stderr: '' });
    },
  };
}

describe('maintenance', () => {
  it('reports existing, re-enabled and new swap', async () => {
    await expect(ensureSwap(runner('exists 2047\n'))).resolves.toContain('already has enough');
    await expect(ensureSwap(runner('enabled\n'))).resolves.toContain('Re-enabled');
    const fresh = runner('added\n');
    await expect(ensureSwap(fresh)).resolves.toBe('Added 2 GB of swap.');
    expect(fresh.scripts[0]).toContain('/etc/fstab');
  });

  it('reports the space pruning freed', async () => {
    await expect(pruneDocker(runner('3072\n'))).resolves.toContain('3.0 GB freed');
  });

  it('produces valid bash', () => {
    for (const make of [ensureSwap, pruneDocker]) {
      const r = runner('0');
      void make(r);
      expect(() => execFileSync('bash', ['-n'], { input: r.scripts[0] })).not.toThrow();
    }
  });
});
