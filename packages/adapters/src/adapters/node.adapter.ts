import { DEFAULT_NODE_VERSION } from '@selfship/shared';
import { header, NODE_DOCKERIGNORE, nodeBuildStage, safeCommand, safePort } from '../dockerfile';
import { installCommand, runScript } from '../node/commands';
import { detectNodeVersion, detectPackageManager, readPackageJson } from '../node/package-json';
import type {
  Adapter,
  BuildConfig,
  DetectResult,
  GeneratedBuildFiles,
  RepoSnapshot,
} from '../types';

/** Default port for Node servers (they're expected to honour `PORT`). */
export const NODE_DEFAULT_PORT = 3000;

/**
 * Generic Node.js server (Express, Fastify, NestJS, Koa…): any project with a
 * `start` script or a `main` entry point.
 */
export const nodeAdapter: Adapter = {
  name: 'node',

  async detect(repo: RepoSnapshot): Promise<DetectResult | null> {
    const pkg = await readPackageJson(repo);
    if (!pkg) return null;

    const start = pkg.scripts.start ? 'start' : null;
    if (!start && !pkg.main) return null;

    const pm = detectPackageManager(repo, pkg);
    return {
      adapter: 'node',
      reason: start ? 'Found a "start" script in package.json' : 'Found "main" in package.json',
      packageManager: pm,
      settings: {
        adapter: 'node',
        installCommand: installCommand(pm, repo),
        buildCommand: pkg.scripts.build ? runScript(pm, 'build') : null,
        startCommand: start ? runScript(pm, 'start') : `node ${pkg.main ?? 'index.js'}`,
        outputDirectory: null,
        port: NODE_DEFAULT_PORT,
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
      header('node'),
      nodeBuildStage(config),
      '',
      `FROM node:${node}-alpine`,
      'WORKDIR /app',
      `ENV NODE_ENV=production PORT=${port}`,
      'COPY --from=build --chown=node:node /app /app',
      'USER node',
      `EXPOSE ${port}`,
      // JSON form + sh -c: the command may use shell features (&&, env vars).
      `CMD ["sh", "-c", ${JSON.stringify(start)}]`,
      '',
    ].join('\n');

    return { Dockerfile: dockerfile, '.dockerignore': NODE_DOCKERIGNORE };
  },
};
