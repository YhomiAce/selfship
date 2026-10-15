import type { GithubAppClient } from './client';

/** Mirrors the adapters package's `RepoSnapshot` (kept structural to avoid a dependency). */
export interface GithubRepoSnapshot {
  readonly files: ReadonlySet<string>;
  readFile(path: string): Promise<string | null>;
}

/** Thrown when the requested root directory doesn't exist on the branch. */
export class RootDirectoryNotFoundError extends Error {
  override name = 'RootDirectoryNotFoundError';
}

/**
 * Builds a read-only view of a project's root folder through the GitHub API,
 * used to detect the framework before anything is cloned.
 *
 * The directory listing is fetched once; files are fetched lazily and cached.
 *
 * @param client - GitHub App client
 * @param installationId - GitHub installation ID
 * @param fullName - `owner/name`
 * @param ref - Branch to inspect
 * @param rootDirectory - Project folder inside the repo ('' = repo root)
 * @returns Snapshot whose paths are relative to `rootDirectory`
 * @throws {RootDirectoryNotFoundError} If the folder doesn't exist
 */
export async function githubRepoSnapshot(
  client: GithubAppClient,
  installationId: number,
  fullName: string,
  ref: string,
  rootDirectory: string,
): Promise<GithubRepoSnapshot> {
  const entries = await client.listDirectory(installationId, fullName, rootDirectory, ref);
  if (entries === null) {
    throw new RootDirectoryNotFoundError(`"${rootDirectory || '/'}" not found on ${ref}`);
  }

  const files = new Set(entries.map((entry) => entry.name));
  const fileNames = new Set(
    entries.filter((entry) => entry.type === 'file').map((entry) => entry.name),
  );
  const cache = new Map<string, Promise<string | null>>();
  const prefix = rootDirectory ? `${rootDirectory}/` : '';

  return {
    files,
    readFile(path: string): Promise<string | null> {
      // Top-level paths not listed as files can't exist; skip the API call.
      if (!path.includes('/') && !fileNames.has(path)) return Promise.resolve(null);
      let pending = cache.get(path);
      if (!pending) {
        pending = client.readFile(installationId, fullName, `${prefix}${path}`, ref);
        cache.set(path, pending);
      }
      return pending;
    },
  };
}
