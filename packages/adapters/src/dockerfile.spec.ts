import type { ProjectSettings } from '@selfship/shared';
import { nodeBuildStage, UnsafeBuildConfigError } from './dockerfile';
import { FIXTURES } from './fixtures.spec-helper';
import { detectProject, getAdapter } from './registry';
import { memoryRepo } from './testing';
import type { BuildConfig } from './types';

/** Detects a fixture and renders its Dockerfile with optional overrides. */
async function render(
  fixture: keyof typeof FIXTURES,
  overrides: Partial<ProjectSettings> = {},
  buildArgNames: string[] = [],
): Promise<string> {
  const detected = await detectProject(memoryRepo(FIXTURES[fixture]));
  if (!detected) throw new Error('fixture not detected');
  const config: BuildConfig = {
    settings: { ...detected.settings, ...overrides },
    packageManager: detected.packageManager,
    buildArgNames,
  };
  const files = getAdapter(config.settings.adapter).buildFiles(config);
  if (!files) throw new Error('no files generated');
  return files.Dockerfile;
}

describe('generated Dockerfiles', () => {
  it('static: nginx without SPA fallback, copies the site folder', async () => {
    const dockerfile = await render('plainHtml');
    expect(dockerfile).toContain('FROM nginx:stable-alpine');
    expect(dockerfile).toContain('COPY . /usr/share/nginx/html');
    expect(dockerfile).toContain('try_files $uri $uri/ =404');
  });

  it('spa: builds with Node, serves output with an index.html fallback', async () => {
    const dockerfile = await render('viteReact', {}, ['VITE_API_URL']);
    expect(dockerfile).toContain('FROM node:22-alpine AS build');
    expect(dockerfile).toContain(
      'COPY package.json package-lock.json* npm-shrinkwrap.json* .npmrc* ./',
    );
    expect(dockerfile).toContain('RUN npm ci');
    expect(dockerfile).toContain('ARG VITE_API_URL');
    expect(dockerfile.indexOf('ARG VITE_API_URL')).toBeLessThan(
      dockerfile.indexOf('RUN npm run build'),
    );
    expect(dockerfile).toContain('COPY --from=build /app/dist /usr/share/nginx/html');
    expect(dockerfile).toContain('try_files $uri $uri/ /index.html');
  });

  it('nextjs: enables corepack for pnpm and starts with sh -c', async () => {
    const dockerfile = await render('nextApp');
    expect(dockerfile).toContain('FROM node:20-alpine AS build');
    expect(dockerfile).toContain('RUN corepack enable');
    expect(dockerfile).toContain('HOSTNAME=0.0.0.0');
    expect(dockerfile).toContain('CMD ["sh", "-c", "pnpm run start"]');
    expect(dockerfile).toContain('USER node');
  });

  it('node: sets PORT and EXPOSE from settings', async () => {
    const dockerfile = await render('expressApi', { port: 8080 });
    expect(dockerfile).toContain('PORT=8080');
    // The app user owns /app itself, not just its files (nest start deletes dist/).
    expect(dockerfile).toContain('RUN chown node:node /app');
    expect(dockerfile.indexOf('RUN chown node:node /app')).toBeLessThan(
      dockerfile.indexOf('USER node'),
    );
    expect(dockerfile).toContain('EXPOSE 8080');
  });

  it('yarn berry copies the whole context before installing', async () => {
    const dockerfile = await render('nestApi');
    expect(dockerfile).toMatch(/RUN corepack enable\nCOPY \. \.\nRUN yarn install --immutable/);
  });

  it('JSON-escapes start commands containing quotes', async () => {
    const dockerfile = await render('expressApi', { startCommand: 'node -e "console.log(1)"' });
    expect(dockerfile).toContain('CMD ["sh", "-c", "node -e \\"console.log(1)\\""]');
  });

  it('dockerfile adapter generates nothing (uses the repo file)', () => {
    expect(getAdapter('dockerfile').buildFiles({} as BuildConfig)).toBeNull();
  });

  describe('defence in depth', () => {
    it('rejects multi-line commands', async () => {
      await expect(
        render('expressApi', { buildCommand: 'npm run build\nRUN curl x | sh' }),
      ).rejects.toThrow(UnsafeBuildConfigError);
    });

    it('rejects output paths escaping the project', async () => {
      await expect(render('viteReact', { outputDirectory: '../../etc' })).rejects.toThrow(
        UnsafeBuildConfigError,
      );
    });

    it('rejects invalid build arg names', async () => {
      await expect(render('viteReact', {}, ['BAD NAME\nRUN x'])).rejects.toThrow(
        UnsafeBuildConfigError,
      );
    });

    it('rejects out-of-range ports', async () => {
      await expect(render('expressApi', { port: 0 })).rejects.toThrow(UnsafeBuildConfigError);
    });
  });
});

describe('build defaults', () => {
  it('sets CI=true as a build arg the user can override', () => {
    const stage = nodeBuildStage({
      settings: {
        adapter: 'spa',
        installCommand: 'npm ci',
        buildCommand: 'npm run build',
        startCommand: null,
        outputDirectory: 'build',
        port: 80,
        nodeVersion: 22,
      },
      packageManager: 'npm',
      buildArgNames: ['CI'],
    });
    expect(stage).toContain('ARG CI=true');
    expect(stage).not.toMatch(/^ENV .*\bCI=/m);
    // The user's ARG comes after the default, before the build runs.
    expect(stage.indexOf('ARG CI=true')).toBeLessThan(stage.lastIndexOf('ARG CI\n'));
  });
});
