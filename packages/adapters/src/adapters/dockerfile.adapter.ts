import type { Adapter, DetectResult, RepoSnapshot } from '../types';

/**
 * Finds the port from the first `EXPOSE` instruction (e.g. `EXPOSE 8080/tcp`).
 *
 * @param dockerfile - Dockerfile contents
 * @returns The port, or null if none is exposed
 */
export function exposedPort(dockerfile: string): number | null {
  const match = /^\s*EXPOSE\s+(\d+)/im.exec(dockerfile);
  const port = match?.[1] ? Number(match[1]) : null;
  return port !== null && port >= 1 && port <= 65535 ? port : null;
}

/**
 * Repositories with their own Dockerfile are built as-is. This is how any
 * language (Go, Python, Java, PHP…) works from day one.
 */
export const dockerfileAdapter: Adapter = {
  name: 'dockerfile',

  async detect(repo: RepoSnapshot): Promise<DetectResult | null> {
    if (!repo.files.has('Dockerfile')) return null;
    const content = (await repo.readFile('Dockerfile')) ?? '';
    const port = exposedPort(content);

    return {
      adapter: 'dockerfile',
      reason: port
        ? `Found a Dockerfile (exposes port ${port}); it will be used as-is`
        : 'Found a Dockerfile; it will be used as-is. Check the port your app listens on',
      packageManager: null,
      settings: {
        adapter: 'dockerfile',
        installCommand: null,
        buildCommand: null,
        startCommand: null,
        outputDirectory: null,
        port: port ?? 3000,
        nodeVersion: null,
      },
    };
  },

  /** The repository's own Dockerfile is used, so nothing is generated. */
  buildFiles(): null {
    return null;
  },
};
