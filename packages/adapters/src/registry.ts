import { DEFAULT_NODE_VERSION, type AdapterName, type ProjectSettings } from '@selfship/shared';
import { dockerfileAdapter } from './adapters/dockerfile.adapter';
import { nextjsAdapter } from './adapters/nextjs.adapter';
import { nodeAdapter } from './adapters/node.adapter';
import { spaAdapter } from './adapters/spa.adapter';
import { staticAdapter } from './adapters/static.adapter';
import type { Adapter, DetectResult, RepoSnapshot } from './types';

/**
 * All adapters in detection order. More specific ones come first: a repo
 * with a Dockerfile uses it even if it's also a Node project, and a Next.js
 * app is not treated as a generic Node server.
 */
export const ADAPTERS: readonly Adapter[] = [
  dockerfileAdapter,
  nextjsAdapter,
  spaAdapter,
  nodeAdapter,
  staticAdapter,
];

/**
 * Looks up an adapter by name.
 *
 * @param name - Adapter name
 * @returns The adapter
 */
export function getAdapter(name: AdapterName): Adapter {
  const adapter = ADAPTERS.find((candidate) => candidate.name === name);
  if (!adapter) throw new Error(`Unknown adapter: ${name}`);
  return adapter;
}

/**
 * Runs adapters in order and returns the first match.
 *
 * @param repo - Project files
 * @param adapters - Adapters to try (defaults to {@link ADAPTERS})
 * @returns The first detection result, or `null` if nothing matched
 */
export async function detectProject(
  repo: RepoSnapshot,
  adapters: readonly Adapter[] = ADAPTERS,
): Promise<DetectResult | null> {
  for (const adapter of adapters) {
    const result = await adapter.detect(repo);
    if (result) return result;
  }
  return null;
}

/**
 * Settings to pre-fill when nothing was detected: a Node server with npm,
 * which the user then adjusts.
 *
 * @returns Editable fallback settings
 */
export function fallbackSettings(): ProjectSettings {
  return {
    adapter: 'node',
    installCommand: 'npm install',
    buildCommand: null,
    startCommand: 'npm start',
    outputDirectory: null,
    port: 3000,
    nodeVersion: DEFAULT_NODE_VERSION,
  };
}
