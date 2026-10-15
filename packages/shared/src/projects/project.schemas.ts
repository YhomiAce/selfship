import { z } from 'zod';

/** Supported project types, in detection priority order. */
export const ADAPTER_NAMES = ['dockerfile', 'nextjs', 'spa', 'node', 'static'] as const;
export const AdapterNameSchema = z.enum(ADAPTER_NAMES);
export type AdapterName = z.infer<typeof AdapterNameSchema>;

/** Human-readable adapter names for the UI. */
export const ADAPTER_LABELS: Record<AdapterName, string> = {
  dockerfile: 'Dockerfile',
  nextjs: 'Next.js',
  spa: 'Single-page app (React, Vue, Angular, Vite…)',
  node: 'Node.js server (Express, Fastify, NestJS…)',
  static: 'Static site (HTML/CSS/JS)',
};

/** JavaScript package managers we know how to install with. */
export const PackageManagerSchema = z.enum(['npm', 'pnpm', 'yarn', 'yarn-berry', 'bun']);
export type PackageManager = z.infer<typeof PackageManagerSchema>;

/** Node.js major versions we build with. */
export const SUPPORTED_NODE_VERSIONS = [18, 20, 22, 24] as const;
export const DEFAULT_NODE_VERSION = 22;

/**
 * A shell command (install/build/start). Single line only: commands are
 * written into a generated Dockerfile, where a newline would start a new
 * instruction. Empty strings become null ("not used").
 */
export const CommandSchema = z
  .string()
  .trim()
  .max(500, 'Use at most 500 characters.')
  .refine((value) => !/[\r\n\0]/.test(value), 'Use a single line.')
  .nullable()
  .transform((value) => (value ? value : null));

/**
 * A path relative to the repository (root directory) or to the project
 * (output directory). Normalised to no leading `./` or slashes; `''` means
 * "the root itself". Rejects `..` and absolute paths so a build can never
 * escape its directory.
 */
export const RelativePathSchema = z
  .string()
  .trim()
  .max(200, 'Use at most 200 characters.')
  .transform((value) => value.replace(/^(\.\/)+/, '').replace(/^\/+|\/+$/g, ''))
  .refine((value) => value === '.' || /^[\w.@-]+(\/[\w.@-]+)*$/.test(value) || value === '', {
    message: 'Use letters, numbers, dots, dashes, underscores and "/" only.',
  })
  .refine((value) => !value.split('/').includes('..'), 'Paths cannot contain "..".')
  .transform((value) => (value === '.' ? '' : value));

/**
 * Project name. Used later in URLs, container names and subdomains, so it's
 * a DNS-safe slug.
 */
export const ProjectNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Enter a project name.')
  .max(40, 'Use at most 40 characters.')
  .regex(
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
    'Use lowercase letters, numbers and dashes (not at the start or end).',
  );

/**
 * `owner/name` of a GitHub repository. Owners are letters, digits and
 * hyphens; repository names may also contain `.` and `_` but can't be `.`
 * or `..` (which would turn into path traversal in API URLs).
 */
export const RepoFullNameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[\w.-]{1,100}$/, 'Invalid repository name.')
  .refine((value) => !['.', '..'].includes(value.split('/')[1] ?? ''), 'Invalid repository name.');

/** A git branch name (conservative subset of what git allows). */
export const BranchNameSchema = z
  .string()
  .trim()
  .min(1, 'Choose a branch.')
  .max(255)
  .refine(
    (value) => !/[\s~^:?*[\\\0]|\.\.|@\{|^\/|\/$|\.lock$/.test(value),
    'Invalid branch name.',
  );

/** Build and run settings of a project (pre-filled by detection, editable). */
export const ProjectSettingsSchema = z
  .object({
    adapter: AdapterNameSchema,
    installCommand: CommandSchema,
    buildCommand: CommandSchema,
    startCommand: CommandSchema,
    outputDirectory: RelativePathSchema.nullable(),
    port: z
      .number({ error: 'Enter a port number.' })
      .int('Use a whole number.')
      .min(1, 'Use a port between 1 and 65535.')
      .max(65535, 'Use a port between 1 and 65535.'),
    nodeVersion: z
      .number()
      .int()
      .refine((value) => (SUPPORTED_NODE_VERSIONS as readonly number[]).includes(value), {
        message: `Supported Node versions: ${SUPPORTED_NODE_VERSIONS.join(', ')}.`,
      })
      .nullable(),
  })
  .superRefine((settings, ctx) => {
    if ((settings.adapter === 'node' || settings.adapter === 'nextjs') && !settings.startCommand) {
      ctx.addIssue({
        code: 'custom',
        path: ['startCommand'],
        message: 'A start command is required for this project type.',
      });
    }
    if (settings.adapter === 'spa' && settings.outputDirectory === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['outputDirectory'],
        message: 'Enter the folder your build writes to (e.g. dist).',
      });
    }
  });
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

/** Which repository/branch/folder to look at. */
export const ProjectSourceSchema = z.object({
  /** Our ID of the GitHub installation (not GitHub's numeric ID). */
  installationId: z.uuid('Choose a GitHub account.'),
  repoFullName: RepoFullNameSchema,
  branch: BranchNameSchema,
  rootDirectory: RelativePathSchema,
});
export type ProjectSource = z.infer<typeof ProjectSourceSchema>;

/** Body of `POST /projects/detect`. */
export const DetectProjectSchema = ProjectSourceSchema;
export type DetectProjectInput = z.infer<typeof DetectProjectSchema>;

/** Response of `POST /projects/detect`. */
export interface DetectProjectResponse {
  /** Detected adapter, or null if nothing matched (the user must choose). */
  adapter: AdapterName | null;
  /** Short explanation shown in the UI, e.g. "Found next in package.json". */
  reason: string;
  /** Suggested settings (sensible fallbacks when nothing was detected). */
  settings: ProjectSettings;
  /** Detected package manager, for display. */
  packageManager: PackageManager | null;
}

/** Body of `POST /projects`. */
export const CreateProjectSchema = z.object({
  name: ProjectNameSchema,
  source: ProjectSourceSchema,
  settings: ProjectSettingsSchema,
});
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;

/** Body of `PATCH /projects/:id`. Source repo can't change; branch/folder can. */
export const UpdateProjectSchema = z.object({
  name: ProjectNameSchema.optional(),
  branch: BranchNameSchema.optional(),
  rootDirectory: RelativePathSchema.optional(),
  settings: ProjectSettingsSchema.optional(),
});
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;

/** State of the GitHub connection behind a project. */
export type GithubConnectionState = 'connected' | 'suspended' | 'removed';

/** Public representation of a project. */
export interface ProjectDto {
  id: string;
  name: string;
  repoFullName: string;
  branch: string;
  rootDirectory: string;
  settings: ProjectSettings;
  github: { installationId: string; accountLogin: string; state: GithubConnectionState };
  createdAt: string;
  updatedAt: string;
}

/** Response of `GET /projects`. */
export interface ProjectListResponse {
  items: ProjectDto[];
}

/** Error codes specific to projects. */
export const ProjectErrorCode = {
  PROJECT_NAME_TAKEN: 'PROJECT_NAME_TAKEN',
  REPO_NOT_ACCESSIBLE: 'REPO_NOT_ACCESSIBLE',
  BRANCH_NOT_FOUND: 'BRANCH_NOT_FOUND',
  ROOT_DIRECTORY_NOT_FOUND: 'ROOT_DIRECTORY_NOT_FOUND',
} as const;
