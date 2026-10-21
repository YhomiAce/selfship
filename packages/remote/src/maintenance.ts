import type { CommandRunner } from './ssh';

/**
 * Adds a swap file when the server has less than 2 GB of swap (memory-hungry
 * builds such as Next.js get killed otherwise). Safe to run again.
 *
 * @param runner - Open connection
 * @returns What was done, for the user
 */
export async function ensureSwap(runner: CommandRunner): Promise<string> {
  const { stdout } = await runner.exec(
    [
      `current=$(awk '/SwapTotal/{print int($2/1024)}' /proc/meminfo)`,
      'if [ "$current" -ge 2000 ]; then echo "exists $current"; exit 0; fi',
      'if [ -f /swapfile ]; then swapon /swapfile 2>/dev/null || true; echo "enabled"; exit 0; fi',
      'fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none',
      'chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile',
      "grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab",
      'echo added',
    ].join('\n'),
    { sudo: true, timeoutMs: 5 * 60_000 },
  );
  const result = stdout.trim();
  if (result.startsWith('exists')) return 'The server already has enough swap.';
  return result === 'enabled' ? 'Re-enabled the existing swap file.' : 'Added 2 GB of swap.';
}

/**
 * Frees disk space: removes Docker's build cache and unused images
 * (running apps and their images are kept).
 *
 * @param runner - Open connection
 * @returns What was done, for the user
 */
export async function pruneDocker(runner: CommandRunner): Promise<string> {
  const { stdout } = await runner.exec(
    [
      `before=$(df -P / | awk 'NR==2{print int($4/1024)}')`,
      'docker builder prune -af >/dev/null 2>&1 || true',
      'docker image prune -af >/dev/null 2>&1 || true',
      `after=$(df -P / | awk 'NR==2{print int($4/1024)}')`,
      'echo $((after - before))',
    ].join('\n'),
    { sudo: true, timeoutMs: 10 * 60_000 },
  );
  const freedMb = Number(stdout.trim()) || 0;
  return `Cleared Docker's build cache and unused images (${(freedMb / 1024).toFixed(1)} GB freed).`;
}
