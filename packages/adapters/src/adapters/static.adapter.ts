import { header, safePath, writeNginxConfig } from '../dockerfile';
import type {
  Adapter,
  BuildConfig,
  DetectResult,
  GeneratedBuildFiles,
  RepoSnapshot,
} from '../types';

/**
 * Plain HTML/CSS/JS sites with no build step, served by nginx. The image is
 * tiny (a few MB of RAM), which is what makes 512 MB servers usable.
 */
export const staticAdapter: Adapter = {
  name: 'static',

  detect(repo: RepoSnapshot): Promise<DetectResult | null> {
    const folder = repo.files.has('index.html')
      ? ''
      : !repo.files.has('package.json') && repo.files.has('public')
        ? 'public'
        : null;
    if (folder === null) return Promise.resolve(null);

    return Promise.resolve({
      adapter: 'static',
      reason:
        folder === ''
          ? 'Found index.html; files are served as they are'
          : 'Found a public/ folder; its files are served as they are',
      packageManager: null,
      settings: {
        adapter: 'static',
        installCommand: null,
        buildCommand: null,
        startCommand: null,
        outputDirectory: folder,
        port: 80,
        nodeVersion: null,
      },
    });
  },

  buildFiles(config: BuildConfig): GeneratedBuildFiles {
    const folder = safePath(config.settings.outputDirectory ?? '');
    const dockerfile = [
      header('static'),
      'FROM nginx:stable-alpine',
      writeNginxConfig(false),
      `COPY ${folder} /usr/share/nginx/html`,
      'EXPOSE 80',
      '',
    ].join('\n');
    const dockerignore = ['.git', 'Dockerfile', '.dockerignore', '.env', '.env.*'].join('\n');
    return { Dockerfile: dockerfile, '.dockerignore': dockerignore };
  },
};
