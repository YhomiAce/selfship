import { z } from 'zod';

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
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    /**
     * Express `trust proxy` setting, so `req.ip` is the real client IP behind the
     * Next.js rewrite / load balancer. Needed for rate limiting and session audit.
     */
    TRUST_PROXY: z.string().default('loopback, linklocal, uniquelocal'),
    /** Days a session stays valid without activity (sliding expiry). */
    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    /** GitHub OAuth app credentials. Leave both empty to disable "Sign in with GitHub". */
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),
  })
  .refine((env) => Boolean(env.GITHUB_CLIENT_ID) === Boolean(env.GITHUB_CLIENT_SECRET), {
    message: 'Set both GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, or neither.',
    path: ['GITHUB_CLIENT_SECRET'],
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
