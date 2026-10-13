import { z } from 'zod';

/**
 * Environment variables required by the worker.
 * Parsed at startup; the process exits if anything is invalid.
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  REDIS_URL: z.url().default('redis://localhost:6380'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
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
