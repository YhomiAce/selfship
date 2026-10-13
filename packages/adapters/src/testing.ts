import type { RepoSnapshot } from './types';

/**
 * Builds an in-memory {@link RepoSnapshot} for tests.
 *
 * @param files - Map of repo-relative path to file contents
 * @returns A snapshot backed by the given map
 */
export function memoryRepo(files: Record<string, string>): RepoSnapshot {
  return {
    files: new Set(Object.keys(files)),
    readFile: (path: string): Promise<string | null> => Promise.resolve(files[path] ?? null),
  };
}
