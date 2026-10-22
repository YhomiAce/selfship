import { DEFAULT_NODE_VERSION } from '@selfship/shared';
import { FIXTURES } from './fixtures.spec-helper';
import { detectProject, getAdapter } from './registry';
import { memoryRepo } from './testing';
import type { DetectResult } from './types';

/** Runs detection on a fixture. */
const detect = (name: keyof typeof FIXTURES): Promise<DetectResult | null> =>
  detectProject(memoryRepo(FIXTURES[name]));

describe('detectProject', () => {
  it('detects a plain HTML site', async () => {
    const result = await detect('plainHtml');
    expect(result).toMatchObject({
      adapter: 'static',
      settings: { outputDirectory: '', port: 80, installCommand: null, buildCommand: null },
    });
  });

  it('serves public/ when there is no index.html and no package.json', async () => {
    expect((await detect('publicFolderSite'))?.settings.outputDirectory).toBe('public');
  });

  it('detects a Vite React app as an SPA served from dist', async () => {
    const result = await detect('viteReact');
    expect(result).toMatchObject({
      adapter: 'spa',
      packageManager: 'npm',
      settings: {
        installCommand: 'npm ci',
        buildCommand: 'npm run build',
        outputDirectory: 'dist',
        port: 80,
      },
    });
    expect(result?.reason).toContain('Vite');
  });

  it('detects Create React App (build/) with yarn', async () => {
    expect(await detect('createReactApp')).toMatchObject({
      adapter: 'spa',
      packageManager: 'yarn',
      settings: { installCommand: 'yarn install --frozen-lockfile', outputDirectory: 'build' },
    });
  });

  it('reads the Angular output path (application builder → /browser)', async () => {
    expect(await detect('angular')).toMatchObject({
      adapter: 'spa',
      packageManager: 'pnpm',
      settings: { outputDirectory: 'dist/shop/browser', nodeVersion: 20 },
    });
  });

  it('detects Vue CLI', async () => {
    expect((await detect('vueCli'))?.settings.outputDirectory).toBe('dist');
  });

  it('detects Next.js with pnpm and the .nvmrc Node version', async () => {
    expect(await detect('nextApp')).toMatchObject({
      adapter: 'nextjs',
      packageManager: 'pnpm',
      settings: {
        installCommand: 'pnpm install --frozen-lockfile',
        buildCommand: 'pnpm run build',
        startCommand: 'pnpm run start',
        port: 3000,
        nodeVersion: 20,
      },
    });
  });

  it("treats Next.js output: 'export' as a static SPA served from out/", async () => {
    expect(await detect('nextStaticExport')).toMatchObject({
      adapter: 'spa',
      settings: { outputDirectory: 'out' },
    });
  });

  it('detects an Express API as a Node server', async () => {
    expect(await detect('expressApi')).toMatchObject({
      adapter: 'node',
      settings: { startCommand: 'npm run start', buildCommand: null, port: 3000 },
    });
  });

  it('detects NestJS with yarn berry and its build script', async () => {
    expect(await detect('nestApi')).toMatchObject({
      adapter: 'node',
      packageManager: 'yarn-berry',
      settings: { installCommand: 'yarn install --immutable', buildCommand: 'yarn build' },
    });
  });

  it('starts NestJS with start:prod rather than nest start', async () => {
    expect(await detect('nestApi')).toMatchObject({
      reason: 'Found a "start:prod" script in package.json',
      settings: { startCommand: 'yarn start:prod' },
    });
  });

  it('does not treat a Vite app with its own Express server as a static SPA', async () => {
    expect((await detect('viteWithExpressServer'))?.adapter).toBe('node');
  });

  it('uses "main" when there is no start script', async () => {
    expect((await detect('mainOnly'))?.settings.startCommand).toBe('node app.js');
  });

  it('prefers the repository Dockerfile and reads EXPOSE', async () => {
    expect(await detect('dockerized')).toMatchObject({
      adapter: 'dockerfile',
      settings: { port: 8080 },
    });
  });

  it('survives an invalid package.json (falls through to static)', async () => {
    expect((await detect('invalidPackageJson'))?.adapter).toBe('static');
  });

  it('survives wrongly-typed package.json fields', async () => {
    const result = await detect('weirdPackageJson');
    expect(result).toMatchObject({ adapter: 'node', settings: { startCommand: 'node server.js' } });
    expect(result?.settings.nodeVersion).toBe(DEFAULT_NODE_VERSION);
  });

  it('returns null when nothing matches', async () => {
    expect(await detect('unknown')).toBeNull();
  });
});

describe('getAdapter', () => {
  it('throws for unknown names', () => {
    expect(() => getAdapter('cobol' as never)).toThrow('Unknown adapter');
  });
});
