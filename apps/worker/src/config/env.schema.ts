import { z } from 'zod';

/**
 * Environment variables required by the worker.
 * Parsed at startup; the process exits if anything is invalid.
 */
export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.url(),
    REDIS_URL: z.url().default('redis://localhost:6380'),
    /** Namespace for job queues in Redis, so environments/test runs sharing a Redis never take each other's jobs. */
    QUEUE_PREFIX: z
      .string()
      .regex(/^[\w:-]{1,64}$/)
      .default('bull'),
    /** Same master key as the API (decrypts stored SSH keys). */
    ENCRYPTION_KEY: z.string().min(1, 'Generate one with: openssl rand -base64 32'),
    ENCRYPTION_KEY_ID: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,32}$/)
      .default('k1'),
    ENCRYPTION_PREVIOUS_KEYS: z.string().optional(),
    /** Allow servers on private addresses (local development only). */
    ALLOW_PRIVATE_SERVER_HOSTS: z.stringbool().default(false),
    /** Let's Encrypt account email used when setting up servers (optional). */
    ACME_EMAIL: z
      .string()
      .optional()
      .transform((value) => (value ? value : undefined)),
    /** Use Let's Encrypt staging certificates (testing, avoids rate limits). */
    ACME_STAGING: z.stringbool().default(false),
    /** Server jobs processed in parallel by this worker. */
    SERVER_JOB_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
    /** Deployments processed in parallel by this worker (across all servers). */
    DEPLOYMENT_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(4),
    /**
     * Builds allowed at once on one server. Builds are memory-hungry; on small
     * VPSes two at once can run out of memory.
     */
    SERVER_BUILD_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(1),
    /**
     * Wildcard DNS service for temporary app URLs until custom domains (M5):
     * apps get `<project>-<id>.<ip-with-dashes>.<PREVIEW_DOMAIN>`.
     */
    PREVIEW_DOMAIN: z
      .string()
      .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)
      .default('sslip.io'),
    /** GitHub App credentials, used to clone repositories (same values as the API). */
    GITHUB_APP_ID: z
      .string()
      .optional()
      .transform((value) => value || undefined),
    GITHUB_APP_PRIVATE_KEY: z
      .string()
      .optional()
      .transform((value) => value || undefined),
    GITHUB_API_URL: z.url().default('https://api.github.com'),
    GITHUB_WEB_URL: z.url().default('https://github.com'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    /** Product name used in email subjects and bodies. */
    APP_NAME: z.string().default('Selfship'),
    /** SMTP server. Defaults point at Mailpit from docker-compose.dev.yml. */
    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().int().positive().default(1026),
    /** `true` for implicit TLS (usually port 465); `false` uses STARTTLS when offered. */
    SMTP_SECURE: z.stringbool().default(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    /** Sender shown to recipients, e.g. `Selfship <no-reply@example.com>`. */
    MAIL_FROM: z.string().default('Selfship <no-reply@selfship.local>'),
  })
  .refine((env) => Boolean(env.GITHUB_APP_ID) === Boolean(env.GITHUB_APP_PRIVATE_KEY), {
    message: 'Set both GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY, or neither.',
    path: ['GITHUB_APP_PRIVATE_KEY'],
  });

export type Env = z.infer<typeof EnvSchema>;

/**
 * Validates raw environment variables against {@link EnvSchema}.
 *
 * @param raw - `process.env` merged with values from `.env`
 * @returns The parsed, typed environment
 * @throws {Error} Listing every invalid variable when validation fails
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
