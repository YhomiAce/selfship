import { z } from 'zod';
import {
  DEFAULT_NODE_VERSION,
  type PackageManager,
  SUPPORTED_NODE_VERSIONS,
} from '@selfship/shared';
import type { RepoSnapshot } from '../types';

/**
 * The parts of package.json we use. Every field is optional and loosely
 * typed: package.json files in the wild are messy, and a strange value must
 * never break detection.
 */
const PackageJsonSchema = z.object({
  name: z.string().optional().catch(undefined),
  main: z.string().optional().catch(undefined),
  scripts: z.record(z.string(), z.string()).optional().catch(undefined),
  dependencies: z.record(z.string(), z.string()).optional().catch(undefined),
  devDependencies: z.record(z.string(), z.string()).optional().catch(undefined),
  engines: z
    .object({ node: z.string().optional().catch(undefined) })
    .optional()
    .catch(undefined),
  packageManager: z.string().optional().catch(undefined),
});

/** Parsed package.json with convenience helpers. */
export interface PackageInfo {
  name: string | null;
  main: string | null;
  scripts: Record<string, string>;
  /** dependencies + devDependencies. */
  deps: Record<string, string>;
  /** Raw `engines.node`, e.g. ">=20". */
  enginesNode: string | null;
  /** Raw `packageManager`, e.g. "pnpm@9.1.0". */
  packageManagerField: string | null;
}

/**
 * Reads and parses `package.json`.
 *
 * @param repo - Project files
 * @returns Parsed info, or `null` when there is no (valid JSON) package.json
 */
export async function readPackageJson(repo: RepoSnapshot): Promise<PackageInfo | null> {
  if (!repo.files.has('package.json')) return null;
  const raw = await repo.readFile('package.json');
  if (raw === null) return null;

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = PackageJsonSchema.safeParse(json);
  if (!parsed.success) return null;

  const pkg = parsed.data;
  return {
    name: pkg.name ?? null,
    main: pkg.main ?? null,
    scripts: pkg.scripts ?? {},
    deps: { ...pkg.dependencies, ...pkg.devDependencies },
    enginesNode: pkg.engines?.node ?? null,
    packageManagerField: pkg.packageManager ?? null,
  };
}

/**
 * Works out which package manager the project uses, from the
 * `packageManager` field first, then lockfiles.
 *
 * @param repo - Project files
 * @param pkg - Parsed package.json
 * @returns The package manager (npm if nothing indicates otherwise)
 */
export function detectPackageManager(repo: RepoSnapshot, pkg: PackageInfo): PackageManager {
  const field = pkg.packageManagerField ?? '';
  if (field.startsWith('pnpm@')) return 'pnpm';
  if (field.startsWith('bun@')) return 'bun';
  if (field.startsWith('yarn@')) return /^yarn@1\./.test(field) ? 'yarn' : 'yarn-berry';
  if (field.startsWith('npm@')) return 'npm';

  if (repo.files.has('pnpm-lock.yaml')) return 'pnpm';
  if (repo.files.has('bun.lockb') || repo.files.has('bun.lock')) return 'bun';
  if (repo.files.has('yarn.lock')) return repo.files.has('.yarnrc.yml') ? 'yarn-berry' : 'yarn';
  return 'npm';
}

/**
 * Extracts a Node major version from strings like "v20.11.0", ">=18",
 * "^22", "20.x" or "lts/iron" (returns null for names).
 *
 * @param value - Version or range
 * @returns First number found, or null
 */
export function parseNodeMajor(value: string): number | null {
  const match = /(\d+)/.exec(value);
  return match?.[1] ? Number(match[1]) : null;
}

/**
 * Picks the Node version to build with: `.nvmrc` / `.node-version` first,
 * then `engines.node`, else the default. Unsupported versions fall back to
 * the default rather than failing the build.
 *
 * @param repo - Project files
 * @param pkg - Parsed package.json
 * @returns A supported Node major version
 */
export async function detectNodeVersion(repo: RepoSnapshot, pkg: PackageInfo): Promise<number> {
  const candidates: (string | null)[] = [
    repo.files.has('.nvmrc') ? await repo.readFile('.nvmrc') : null,
    repo.files.has('.node-version') ? await repo.readFile('.node-version') : null,
    pkg.enginesNode,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const major = parseNodeMajor(candidate);
    if (major === null) continue;
    if ((SUPPORTED_NODE_VERSIONS as readonly number[]).includes(major)) return major;
    // ">=16" style ranges: use the oldest supported version that satisfies it.
    if (candidate.trim().startsWith('>')) {
      const satisfying = SUPPORTED_NODE_VERSIONS.find((v) => v >= major);
      if (satisfying !== undefined) return satisfying;
    }
  }
  return DEFAULT_NODE_VERSION;
}

/**
 * Whether the project depends on a package.
 *
 * @param pkg - Parsed package.json
 * @param names - Package names; true if any is present
 * @returns True when at least one is a dependency or devDependency
 */
export function hasDep(pkg: PackageInfo, ...names: string[]): boolean {
  return names.some((name) => Object.hasOwn(pkg.deps, name));
}
