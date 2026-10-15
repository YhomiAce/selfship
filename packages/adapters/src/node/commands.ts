import type { PackageManager } from '@selfship/shared';
import type { RepoSnapshot } from '../types';

/** Lockfile for each package manager (used to choose a strict install). */
const LOCKFILES: Record<PackageManager, readonly string[]> = {
  npm: ['package-lock.json', 'npm-shrinkwrap.json'],
  pnpm: ['pnpm-lock.yaml'],
  yarn: ['yarn.lock'],
  'yarn-berry': ['yarn.lock'],
  bun: ['bun.lockb', 'bun.lock'],
};

/**
 * Install command for a package manager. With a lockfile we use the strict
 * variant, so builds are reproducible and fail loudly if the lockfile is stale.
 *
 * @param pm - Package manager
 * @param repo - Project files (to check for a lockfile)
 * @returns Install command
 */
export function installCommand(pm: PackageManager, repo: RepoSnapshot): string {
  const locked = LOCKFILES[pm].some((file) => repo.files.has(file));
  switch (pm) {
    case 'npm':
      return locked ? 'npm ci' : 'npm install';
    case 'pnpm':
      return locked ? 'pnpm install --frozen-lockfile' : 'pnpm install';
    case 'yarn':
      return locked ? 'yarn install --frozen-lockfile' : 'yarn install';
    case 'yarn-berry':
      return locked ? 'yarn install --immutable' : 'yarn install';
    case 'bun':
      return locked ? 'bun install --frozen-lockfile' : 'bun install';
  }
}

/**
 * Command that runs a package.json script.
 *
 * @param pm - Package manager
 * @param script - Script name, e.g. "build"
 * @returns Command such as `npm run build`
 */
export function runScript(pm: PackageManager, script: string): string {
  switch (pm) {
    case 'npm':
      return `npm run ${script}`;
    case 'pnpm':
      return `pnpm run ${script}`;
    case 'yarn':
    case 'yarn-berry':
      return `yarn ${script}`;
    case 'bun':
      return `bun run ${script}`;
  }
}
