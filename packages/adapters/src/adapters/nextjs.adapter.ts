import { DEFAULT_NODE_VERSION } from '@selfship/shared';
import {
  header,
  NODE_DOCKERIGNORE,
  nodeBuildStage,
  OPENSSL,
  safeCommand,
  safePort,
} from '../dockerfile';
import { installCommand, runScript } from '../node/commands';
import {
  detectNodeVersion,
  detectPackageManager,
  hasDep,
  readPackageJson,
} from '../node/package-json';
import type {
  Adapter,
  BuildConfig,
  DetectResult,
  GeneratedBuildFiles,
  RepoSnapshot,
} from '../types';

/** next.config file names, in the order Next.js looks for them. */
export const NEXT_CONFIG_FILES = [
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'next.config.cjs',
];

/**
 * Whether the Next.js config uses `output: 'export'` (a fully static site,
 * which the SPA adapter serves better than a Node server).
 *
 * @param repo - Project files
 * @returns True for static exports
 */
export async function isNextStaticExport(repo: RepoSnapshot): Promise<boolean> {
  for (const file of NEXT_CONFIG_FILES) {
    if (!repo.files.has(file)) continue;
    const content = (await repo.readFile(file)) ?? '';
    if (/output\s*:\s*["'`]export["'`]/.test(content)) return true;
  }
  return false;
}

/** Next.js apps served by `next start`. */
export const nextjsAdapter: Adapter = {
  name: 'nextjs',

  async detect(repo: RepoSnapshot): Promise<DetectResult | null> {
    const pkg = await readPackageJson(repo);
    if (!pkg || !hasDep(pkg, 'next')) return null;
    // Static exports are handled by the SPA adapter.
    if (await isNextStaticExport(repo)) return null;

    const pm = detectPackageManager(repo, pkg);
    return {
      adapter: 'nextjs',
      reason: 'Found next in package.json',
      packageManager: pm,
      settings: {
        adapter: 'nextjs',
        installCommand: installCommand(pm, repo),
        buildCommand: runScript(pm, 'build'),
        startCommand: pkg.scripts.start ? runScript(pm, 'start') : 'npx next start',
        outputDirectory: null,
        port: 3000,
        nodeVersion: await detectNodeVersion(repo, pkg),
      },
    };
  },

  buildFiles(config: BuildConfig): GeneratedBuildFiles {
    const { settings } = config;
    const port = safePort(settings.port);
    const start = safeCommand(settings.startCommand ?? '', 'Start command');
    const node = settings.nodeVersion ?? DEFAULT_NODE_VERSION;

    const dockerfile = [
      header('nextjs'),
      nodeBuildStage(config),
      '',
      `FROM node:${node}-alpine`,
      'WORKDIR /app',
      // WORKDIR creates /app as root; the app may write next to its files (e.g. nest start clears dist/).
      'RUN chown node:node /app',
      OPENSSL,
      // next start reads PORT and HOSTNAME; 0.0.0.0 so it's reachable from outside the container.
      `ENV NODE_ENV=production PORT=${port} HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1`,
      'COPY --from=build --chown=node:node /app /app',
      'USER node',
      `EXPOSE ${port}`,
      `CMD ["sh", "-c", ${JSON.stringify(start)}]`,
      '',
    ].join('\n');

    return { Dockerfile: dockerfile, '.dockerignore': NODE_DOCKERIGNORE };
  },
};
