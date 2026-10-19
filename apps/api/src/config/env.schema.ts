import { z } from 'zod';

/** Optional string where an empty value (`KEY=` in .env) counts as "not set". */
const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined));

/** The GitHub App settings, which must be set all together or not at all. */
const GITHUB_APP_KEYS = [
  'GITHUB_APP_ID',
  'GITHUB_APP_SLUG',
  'GITHUB_APP_CLIENT_ID',
  'GITHUB_APP_CLIENT_SECRET',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_WEBHOOK_SECRET',
] as const;

/**
 * Environment variables required by the API.
 *
 * Parsed once at startup; the app refuses to start if anything is missing or
 * malformed, so misconfiguration fails fast instead of at first use.
 */
export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().positive().default(4000),
    /** Public URL of the web app; used for CORS and links in emails. */
    WEB_URL: z.url().default('http://localhost:3000'),
    DATABASE_URL: z.url(),
    REDIS_URL: z.url().default('redis://localhost:6380'),
    /** Namespace for job queues in Redis, so environments/test runs sharing a Redis never take each other's jobs. */
    QUEUE_PREFIX: z
      .string()
      .regex(/^[\w:-]{1,64}$/)
      .default('bull'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    /**
     * Express `trust proxy` setting, so `req.ip` is the real client IP behind the
     * Next.js rewrite / load balancer. Needed for rate limiting and session audit.
     */
    TRUST_PROXY: z.string().default('loopback, linklocal, uniquelocal'),
    /** Days a session stays valid without activity (sliding expiry). */
    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    /** GitHub OAuth app credentials. Leave both empty to disable "Sign in with GitHub". */
    GITHUB_CLIENT_ID: optionalString,
    GITHUB_CLIENT_SECRET: optionalString,

    /** GitHub App (repository access). See docs/guides/github-app-setup.md. */
    GITHUB_APP_ID: optionalString,
    GITHUB_APP_SLUG: optionalString,
    GITHUB_APP_CLIENT_ID: optionalString,
    GITHUB_APP_CLIENT_SECRET: optionalString,
    /** PEM private key; `\n` escapes are accepted for single-line env files. */
    GITHUB_APP_PRIVATE_KEY: optionalString,
    GITHUB_WEBHOOK_SECRET: optionalString,
    /**
     * Master key for encrypting secrets at rest (SSH keys…): 32 random bytes,
     * base64 (`openssl rand -base64 32`). Never commit it; losing it makes
     * stored keys unreadable.
     */
    ENCRYPTION_KEY: z.string().min(1, 'Generate one with: openssl rand -base64 32'),
    /** Identifier stored with each ciphertext (change when rotating). */
    ENCRYPTION_KEY_ID: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,32}$/)
      .default('k1'),
    /** Older keys still accepted for decryption: "id:base64,id:base64". */
    ENCRYPTION_PREVIOUS_KEYS: optionalString,
    /**
     * Allow servers on private/loopback addresses. Local development only:
     * in production this would let users make the worker connect to our own
     * internal network.
     */
    ALLOW_PRIVATE_SERVER_HOSTS: z.stringbool().default(false),
    /** Override for GitHub Enterprise Server (or a local mock). */
    GITHUB_API_URL: z.url().default('https://api.github.com'),
    GITHUB_WEB_URL: z.url().default('https://github.com'),
    /**
     * Free subdomains `<project>.<PLATFORM_APPS_DOMAIN>` via Cloudflare DNS
     * (same values as the worker). All three or none.
     */
    PLATFORM_APPS_DOMAIN: optionalString,
    CLOUDFLARE_API_TOKEN: optionalString,
    CLOUDFLARE_ZONE_ID: optionalString,
    /** Wildcard DNS service for temporary URLs (same as the worker). */
    PREVIEW_DOMAIN: z.string().default('sslip.io'),
    /** Domains users can't add as custom domains (ours), comma-separated. */
    RESERVED_DOMAINS: z.string().default('selfship.dev,selfship.app'),
  })
  .refine((env) => Boolean(env.GITHUB_CLIENT_ID) === Boolean(env.GITHUB_CLIENT_SECRET), {
    message: 'Set both GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, or neither.',
    path: ['GITHUB_CLIENT_SECRET'],
  })
  .refine(
    (env) =>
      new Set([
        Boolean(env.PLATFORM_APPS_DOMAIN),
        Boolean(env.CLOUDFLARE_API_TOKEN),
        Boolean(env.CLOUDFLARE_ZONE_ID),
      ]).size === 1,
    {
      message:
        'Set PLATFORM_APPS_DOMAIN, CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID together, or none.',
      path: ['CLOUDFLARE_API_TOKEN'],
    },
  )
  .superRefine((env, ctx) => {
    const set = GITHUB_APP_KEYS.filter((key) => env[key] !== undefined);
    if (set.length > 0 && set.length < GITHUB_APP_KEYS.length) {
      for (const key of GITHUB_APP_KEYS.filter((k) => env[k] === undefined)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message:
            'Required when any GITHUB_APP_* setting is set (configure the GitHub App fully or not at all).',
        });
      }
    }
  });

export type Env = z.infer<typeof EnvSchema>;

/**
 * Validates raw environment variables against {@link EnvSchema}.
 *
 * Passed to `ConfigModule.forRoot({ validate })`.
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
