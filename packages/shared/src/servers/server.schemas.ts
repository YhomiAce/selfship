import { z } from 'zod';

/** Server lifecycle states (mirrors the database enum). */
export const SERVER_STATUSES = [
  'awaiting_key',
  'checking',
  'checked',
  'needs_attention',
  'setting_up',
  'setup_failed',
  'ready',
  'unreachable',
] as const;
export type ServerStatus = (typeof SERVER_STATUSES)[number];

/** Short labels for status badges. */
export const SERVER_STATUS_LABELS: Record<ServerStatus, string> = {
  awaiting_key: 'Waiting for key',
  checking: 'Checking…',
  checked: 'Not set up',
  needs_attention: 'Needs attention',
  setting_up: 'Setting up…',
  setup_failed: 'Setup failed',
  ready: 'Ready',
  unreachable: 'Unreachable',
};

/** What a server can run. */
export type CapabilityTier = 'static_only' | 'standard' | 'recommended';

/** Labels and explanations for capability tiers. */
export const CAPABILITY_TIER_LABELS: Record<
  CapabilityTier,
  { label: string; description: string }
> = {
  static_only: {
    label: 'Static sites only',
    description: 'Under 1 GB of RAM: static and single-page sites.',
  },
  standard: {
    label: 'Standard',
    description: '1–2 GB of RAM (swap added): most apps; large builds are slower.',
  },
  recommended: {
    label: 'Recommended',
    description: '2 GB or more: everything, including Next.js.',
  },
};

/** How we get access to a server. */
export const SERVER_KEY_METHODS = ['generated', 'pasted', 'password'] as const;
export type ServerKeyMethod = (typeof SERVER_KEY_METHODS)[number];

/** Server display name (unique per user). */
export const ServerNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a name.')
  .max(40, 'Use at most 40 characters.')
  .regex(/^[\w .-]+$/, 'Use letters, numbers, spaces, dots, dashes and underscores.');

/**
 * Hostname or IP. Format only; the API additionally resolves it and refuses
 * private/internal addresses.
 */
export const ServerHostSchema = z
  .string()
  .trim()
  .min(1, "Enter the server's IP address or hostname.")
  .max(253)
  .refine((value) => /^[a-zA-Z0-9.-]+$/.test(value) || /^[0-9a-fA-F:]+$/.test(value), {
    message: 'Enter an IP address or a hostname like server.example.com (no http:// or port).',
  });

/** SSH port. */
export const SshPortSchema = z
  .number({ error: 'Enter a port.' })
  .int()
  .min(1)
  .max(65535, 'Use a port between 1 and 65535.');

/** Linux user name for SSH. */
export const SshUserSchema = z
  .string()
  .trim()
  .min(1, 'Enter the SSH user.')
  .max(32)
  .regex(/^[a-z_][a-z0-9_-]*\$?$/, 'Enter a valid Linux user name, e.g. root or ubuntu.');

const BaseServerSchema = z.object({
  name: ServerNameSchema,
  host: ServerHostSchema,
  port: SshPortSchema,
  sshUser: SshUserSchema,
});

/** Body of `POST /servers`: one shape per access method. */
export const CreateServerSchema = z.discriminatedUnion('method', [
  BaseServerSchema.extend({ method: z.literal('generated') }),
  BaseServerSchema.extend({
    method: z.literal('pasted'),
    privateKey: z
      .string()
      .min(1, 'Paste the private key.')
      .max(16_384, 'That key is too long.')
      .refine(
        (value) => value.includes('PRIVATE KEY'),
        'Paste the whole private key, including the BEGIN/END lines.',
      ),
  }),
  BaseServerSchema.extend({
    method: z.literal('password'),
    password: z.string().min(1, 'Enter the password.').max(1024),
  }),
]);
export type CreateServerInput = z.infer<typeof CreateServerSchema>;

/** Kinds of server jobs. */
export type ServerJobType = 'check' | 'setup';
/** Job states. */
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

/** A check or setup run. */
export interface ServerJobDto {
  id: string;
  type: ServerJobType;
  status: JobStatus;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** A job including its saved log. */
export interface ServerJobDetailDto extends ServerJobDto {
  log: string;
}

/** Public representation of a server. Never includes the private key. */
export interface ServerDto {
  id: string;
  name: string;
  host: string;
  port: number;
  sshUser: string;
  keySource: ServerKeyMethod;
  status: ServerStatus;
  statusMessage: string | null;
  hostKeyFingerprint: string | null;
  /** Our `authorized_keys` line (safe to show; it's a public key). */
  publicKey: string;
  /** Command that adds our key on the server (generated-key method). */
  authorizeCommand: string;
  /** Command that removes our key from the server. */
  revokeCommand: string;
  specs: {
    os: string | null;
    osVersion: string | null;
    arch: string | null;
    cpus: number | null;
    ramMb: number | null;
    swapMb: number | null;
    diskFreeGb: number | null;
    dockerVersion: string | null;
  };
  tier: CapabilityTier | null;
  problems: string[];
  warnings: string[];
  lastCheckedAt: string | null;
  readyAt: string | null;
  /** A platform-owned sandbox server (shared by users' free apps). */
  isPlatformSandbox: boolean;
  /** Most recent job, for showing progress without another request. */
  latestJob: ServerJobDto | null;
  createdAt: string;
}

/** Response of `GET /servers`. */
export interface ServerListResponse {
  items: ServerDto[];
}

/** Response of `GET /servers/:id/jobs`. */
export interface ServerJobListResponse {
  items: ServerJobDto[];
}

/** Response of `DELETE /servers/:id`: how to revoke our access. */
export interface DeleteServerResponse {
  revokeCommand: string;
}

/** Events on `GET /servers/:id/jobs/:jobId/stream` (Server-Sent Events). */
export type ServerJobEvent =
  { type: 'line'; line: string } | { type: 'end'; status: JobStatus; error: string | null };

/** Error codes specific to servers. */
export const ServerErrorCode = {
  SERVER_NAME_TAKEN: 'SERVER_NAME_TAKEN',
  FORBIDDEN_HOST: 'FORBIDDEN_HOST',
  INVALID_PRIVATE_KEY: 'INVALID_PRIVATE_KEY',
  PASSWORD_LOGIN_FAILED: 'PASSWORD_LOGIN_FAILED',
  JOB_IN_PROGRESS: 'JOB_IN_PROGRESS',
} as const;
