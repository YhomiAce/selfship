import type { RepoSnapshot } from '@selfship/adapters';
import { type CommandRunner, sh } from './ssh';

/**
 * A {@link RepoSnapshot} over a clone that lives on the server, so the same
 * adapters that detect projects through the GitHub API work at build time.
 *
 * @param runner - Connection to the server
 * @param dir - Absolute path of the project root on the server
 * @returns Snapshot with lazily fetched, cached file contents
 */
export async function remoteSnapshot(runner: CommandRunner, dir: string): Promise<RepoSnapshot> {
  const { stdout } = await runner.exec(`ls -A1 ${sh(dir)}`, { sudo: true });
  const files = new Set(
    stdout
      .split('\n')
      .map((name) => name.trim())
      .filter(Boolean),
  );
  const cache = new Map<string, Promise<string | null>>();

  return {
    files,
    readFile(file: string): Promise<string | null> {
      if (file.split('/').some((part) => part === '..')) return Promise.resolve(null);
      let pending = cache.get(file);
      if (!pending) {
        // Regular files under 512 KB only; anything else counts as missing.
        const full = `${dir}/${file}`;
        pending = runner
          .exec(
            `[ -f ${sh(full)} ] && [ "$(stat -c %s ${sh(full)})" -le 524288 ] && cat ${sh(full)}`,
            {
              sudo: true,
              check: false,
            },
          )
          .then((result) => (result.code === 0 ? result.stdout : null));
        cache.set(file, pending);
      }
      return pending;
    },
  };
}
