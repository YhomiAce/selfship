/** Stable identifiers of supported adapters. */
export type AdapterName = 'dockerfile' | 'nextjs' | 'node' | 'spa' | 'static';

/**
 * Read-only view of a repository, used for detection.
 *
 * Implemented on top of the GitHub API (before the first deploy) or a local
 * clone (on the server), so adapters never care where files come from.
 */
export interface RepoSnapshot {
  /** Repo-relative paths of files in the project's root directory. */
  readonly files: ReadonlySet<string>;
  /**
   * Reads a file's contents.
   *
   * @param path - Repo-relative path
   * @returns The file contents, or `null` if it does not exist
   */
  readFile(path: string): Promise<string | null>;
}

/** Outcome of a successful detection. */
export interface DetectResult {
  adapter: AdapterName;
  /** Short human-readable explanation shown in the UI, e.g. "Found next in package.json". */
  reason: string;
}

/** Settings pre-filled in the UI after detection (the user can override them). */
export interface AdapterDefaults {
  installCommand?: string;
  buildCommand?: string;
  startCommand?: string;
  /** Directory containing build output, for static/SPA adapters. */
  outputDirectory?: string;
  /** Port the app listens on inside the container. */
  port: number;
}

/** Final per-project settings used to render the Dockerfile. */
export interface BuildConfig extends AdapterDefaults {
  /** Node major version for JS adapters, e.g. `22`. */
  nodeVersion?: number;
  /** Names of build-time environment variables (values are passed as build args). */
  buildArgNames: readonly string[];
}

/**
 * One supported framework or project type.
 *
 * To support a new language, implement this interface and register the
 * adapter in detection order.
 */
export interface Adapter {
  readonly name: AdapterName;

  /**
   * Checks whether this adapter can handle the repository.
   *
   * @param repo - Repository snapshot
   * @returns A result if the adapter matches, otherwise `null`
   */
  detect(repo: RepoSnapshot): Promise<DetectResult | null>;

  /**
   * Suggests default build settings for the repository.
   *
   * @param repo - Repository snapshot
   * @returns Defaults to pre-fill in the UI
   */
  defaults(repo: RepoSnapshot): Promise<AdapterDefaults>;

  /**
   * Renders the Dockerfile used to build the app.
   *
   * @param config - Final build settings
   * @returns Dockerfile contents
   */
  dockerfile(config: BuildConfig): string;
}
