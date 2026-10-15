import { z } from 'zod';
import {
  header,
  NODE_DOCKERIGNORE,
  nodeBuildStage,
  safePath,
  writeNginxConfig,
} from '../dockerfile';
import { installCommand, runScript } from '../node/commands';
import {
  detectNodeVersion,
  detectPackageManager,
  hasDep,
  type PackageInfo,
  readPackageJson,
} from '../node/package-json';
import type {
  Adapter,
  BuildConfig,
  DetectResult,
  GeneratedBuildFiles,
  RepoSnapshot,
} from '../types';
import { isNextStaticExport } from './nextjs.adapter';

/**
 * Packages that mean "this app runs its own server", so it isn't a static SPA
 * even if it also uses Vite.
 */
const SERVER_FRAMEWORKS = [
  'express',
  'fastify',
  '@nestjs/core',
  'koa',
  '@hapi/hapi',
  'hono',
  'nuxt',
  '@sveltejs/kit',
  '@remix-run/node',
  '@remix-run/serve',
];

/** A recognised SPA toolchain and where its build output goes. */
interface SpaToolchain {
  label: string;
  outputDirectory: string;
}

// Only the fields we read from angular.json; anything unexpected is ignored.
const AngularJsonSchema = z.object({
  defaultProject: z.string().optional().catch(undefined),
  projects: z
    .record(
      z.string(),
      z.object({
        architect: z
          .object({
            build: z
              .object({
                builder: z.string().optional().catch(undefined),
                options: z
                  .object({
                    outputPath: z
                      .union([z.string(), z.object({ base: z.string() })])
                      .optional()
                      .catch(undefined),
                  })
                  .optional()
                  .catch(undefined),
              })
              .optional()
              .catch(undefined),
          })
          .optional()
          .catch(undefined),
      }),
    )
    .catch({}),
});

/**
 * Reads Angular's build output folder from angular.json. The modern
 * "application" builder writes browser files to `<outputPath>/browser`.
 *
 * @param repo - Project files
 * @param pkg - Parsed package.json (for the fallback project name)
 * @returns Output folder relative to the project root
 */
async function angularOutputDirectory(repo: RepoSnapshot, pkg: PackageInfo): Promise<string> {
  const fallback = `dist/${pkg.name ?? 'app'}/browser`;
  const raw = repo.files.has('angular.json') ? await repo.readFile('angular.json') : null;
  if (!raw) return fallback;

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return fallback;
  }
  const parsed = AngularJsonSchema.safeParse(json);
  if (!parsed.success) return fallback;

  const { defaultProject, projects } = parsed.data;
  const name = defaultProject ?? Object.keys(projects)[0];
  const build = name ? projects[name]?.architect?.build : undefined;
  const outputPath = build?.options?.outputPath;
  const base = typeof outputPath === 'string' ? outputPath : outputPath?.base;
  if (!base) return `dist/${name ?? pkg.name ?? 'app'}/browser`;

  const usesApplicationBuilder = build?.builder?.endsWith(':application') ?? false;
  const clean = base.replace(/^\.\//, '').replace(/\/+$/, '');
  return usesApplicationBuilder ? `${clean}/browser` : clean;
}

/**
 * Identifies the SPA toolchain and its output folder.
 *
 * @param repo - Project files
 * @param pkg - Parsed package.json
 * @returns The toolchain, or null if this doesn't look like a static SPA
 */
async function detectToolchain(repo: RepoSnapshot, pkg: PackageInfo): Promise<SpaToolchain | null> {
  if (hasDep(pkg, 'next')) {
    return (await isNextStaticExport(repo))
      ? { label: 'Next.js static export', outputDirectory: 'out' }
      : null;
  }
  if (hasDep(pkg, ...SERVER_FRAMEWORKS)) return null;
  if (hasDep(pkg, '@angular/core')) {
    return { label: 'Angular', outputDirectory: await angularOutputDirectory(repo, pkg) };
  }
  if (hasDep(pkg, 'react-scripts')) return { label: 'Create React App', outputDirectory: 'build' };
  if (hasDep(pkg, '@vue/cli-service')) return { label: 'Vue CLI', outputDirectory: 'dist' };
  if (hasDep(pkg, 'astro')) return { label: 'Astro', outputDirectory: 'dist' };
  if (hasDep(pkg, 'vite')) return { label: 'Vite', outputDirectory: 'dist' };
  if (hasDep(pkg, 'parcel')) return { label: 'Parcel', outputDirectory: 'dist' };
  return null;
}

/**
 * Single-page apps and static-site generators: built with Node, then served
 * as static files by nginx with a fallback to index.html for client routing.
 */
export const spaAdapter: Adapter = {
  name: 'spa',

  async detect(repo: RepoSnapshot): Promise<DetectResult | null> {
    const pkg = await readPackageJson(repo);
    if (!pkg) return null;
    const toolchain = await detectToolchain(repo, pkg);
    if (!toolchain) return null;

    const pm = detectPackageManager(repo, pkg);
    return {
      adapter: 'spa',
      reason: `Found ${toolchain.label}; the build output in "${toolchain.outputDirectory}" is served as static files`,
      packageManager: pm,
      settings: {
        adapter: 'spa',
        installCommand: installCommand(pm, repo),
        buildCommand: runScript(pm, 'build'),
        startCommand: null,
        outputDirectory: toolchain.outputDirectory,
        port: 80,
        nodeVersion: await detectNodeVersion(repo, pkg),
      },
    };
  },

  buildFiles(config: BuildConfig): GeneratedBuildFiles {
    const output = safePath(config.settings.outputDirectory ?? 'dist');
    const dockerfile = [
      header('spa'),
      nodeBuildStage(config),
      '',
      'FROM nginx:stable-alpine',
      writeNginxConfig(true),
      `COPY --from=build /app/${output} /usr/share/nginx/html`,
      'EXPOSE 80',
      '',
    ].join('\n');
    return { Dockerfile: dockerfile, '.dockerignore': NODE_DOCKERIGNORE };
  },
};
