import type { RepoSnapshot } from './types';

/**
 * Builds an in-memory {@link RepoSnapshot} for tests and fixtures.
 * Top-level names are derived from the paths (folders included).
 *
 * @param files - Map of path (relative to the project root) to contents
 * @returns A snapshot backed by the given map
 */
export function memoryRepo(files: Record<string, string>): RepoSnapshot {
  const topLevel = new Set(Object.keys(files).map((path) => path.split('/')[0] ?? path));
  return {
    files: topLevel,
    readFile: (path: string): Promise<string | null> =>
      Promise.resolve(Object.hasOwn(files, path) ? (files[path] ?? null) : null),
  };
}
