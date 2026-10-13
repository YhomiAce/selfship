import { z } from 'zod';

/**
 * Environment variables required by the worker.
 * Parsed at startup; the process exits if anything is invalid.
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  REDIS_URL: z.url().default('redis://localhost:6380'),
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
