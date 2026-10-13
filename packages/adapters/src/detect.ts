import type { Adapter, DetectResult, RepoSnapshot } from './types';

/**
 * Runs adapters in order and returns the first match.
 *
 * Order matters: more specific adapters (e.g. `dockerfile`, `nextjs`) must
 * come before generic ones (e.g. `node`, `static`).
 *
 * @param adapters - Adapters in priority order
 * @param repo - Repository snapshot
 * @returns The first matching adapter and its detection result, or `null`
 */
export async function detectAdapter(
  adapters: readonly Adapter[],
  repo: RepoSnapshot,
): Promise<{ adapter: Adapter; result: DetectResult } | null> {
  for (const adapter of adapters) {
    const result = await adapter.detect(repo);
    if (result) return { adapter, result };
  }
  return null;
}
