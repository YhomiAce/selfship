import type { RepoSnapshot } from '@selfship/adapters';
import { type SshConnection, sh } from './ssh.ts';

/**
 * A {@link RepoSnapshot} over a clone that lives on the server, so the same
 * adapters that detect projects through the GitHub API work at build time.
 *
 * @param ssh - Open connection
 * @param dir - Absolute path of the project root on the server
 * @returns Snapshot with lazily fetched, cached file contents
 */
export async function remoteSnapshot(ssh: SshConnection, dir: string): Promise<RepoSnapshot> {
  const { stdout } = await ssh.exec(`ls -A1 ${sh(dir)}`, { sudo: true });
  const files = new Set(
    stdout
      .split('\n')
      .map((name) => name.trim())
      .filter(Boolean),
  );
  const cache = new Map<string, Promise<string | null>>();

  return {
    files,
    readFile(path: string): Promise<string | null> {
      if (path.split('/').some((part) => part === '..')) return Promise.resolve(null);
      let pending = cache.get(path);
      if (!pending) {
        // Regular files under 512 KB only; anything else counts as missing.
        const file = `${dir}/${path}`;
        pending = ssh
          .exec(
            `[ -f ${sh(file)} ] && [ "$(stat -c %s ${sh(file)})" -le 524288 ] && cat ${sh(file)}`,
            {
              sudo: true,
              check: false,
            },
          )
          .then((result) => (result.code === 0 ? result.stdout : null));
        cache.set(path, pending);
      }
      return pending;
    },
  };
}
