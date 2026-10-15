import type { AdapterName, PackageManager, ProjectSettings } from '@selfship/shared';

export type { AdapterName, PackageManager, ProjectSettings } from '@selfship/shared';

/**
 * Read-only view of a project's files, used for detection.
 *
 * Implemented on top of the GitHub API (before the first deploy) or a local
 * clone (on the server), so adapters never care where files come from.
 * All paths are relative to the project's root directory.
 */
export interface RepoSnapshot {
  /** Names of files and folders directly inside the project root. */
  readonly files: ReadonlySet<string>;
  /**
   * Reads a text file.
   *
   * @param path - Path relative to the project root
   * @returns The contents, or `null` if missing, a directory, or too large
   */
  readFile(path: string): Promise<string | null>;
}

/** Outcome of a successful detection. */
export interface DetectResult {
  adapter: AdapterName;
  /** Short explanation shown in the UI, e.g. "Found next in package.json". */
  reason: string;
  /** Suggested settings for this repository. */
  settings: ProjectSettings;
  packageManager: PackageManager | null;
}

/** Final settings used to render build files. */
export interface BuildConfig {
  settings: ProjectSettings;
  /** Package manager (JS adapters). Defaults to npm when unknown. */
  packageManager: PackageManager | null;
  /** Names of build-time environment variables (values passed as build args). */
  buildArgNames: readonly string[];
}

/** Files to write into the build context before `docker build`. */
export interface GeneratedBuildFiles {
  Dockerfile: string;
  '.dockerignore': string;
}

/**
 * One supported framework or project type.
 *
 * To support a new language, implement this interface and add the adapter
 * to `ADAPTERS` in detection order.
 */
export interface Adapter {
  readonly name: AdapterName;

  /**
   * Checks whether this adapter can handle the project.
   *
   * @param repo - Project files
   * @returns Detection result with suggested settings, or `null` if no match
   */
  detect(repo: RepoSnapshot): Promise<DetectResult | null>;

  /**
   * Renders the files needed to build the image.
   *
   * @param config - Final, validated build settings
   * @returns Generated files, or `null` when the repository's own Dockerfile is used
   */
  buildFiles(config: BuildConfig): GeneratedBuildFiles | null;
}
