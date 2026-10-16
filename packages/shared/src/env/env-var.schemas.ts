import { z } from 'zod';
import { ENV_KEY_PATTERN } from './dotenv';

/**
 * When a variable is available:
 * - `runtime`: to the running app only (secrets belong here)
 * - `build`: during `docker build` only (e.g. `NEXT_PUBLIC_*`, inlined into the bundle)
 * - `both`: during the build and at run time
 */
export const ENV_SCOPES = ['runtime', 'build', 'both'] as const;
export const EnvScopeSchema = z.enum(ENV_SCOPES);
export type EnvScope = z.infer<typeof EnvScopeSchema>;

/** Labels for the UI. */
export const ENV_SCOPE_LABELS: Record<EnvScope, string> = {
  runtime: 'Runtime',
  build: 'Build',
  both: 'Build + runtime',
};

/** Names we set ourselves; users can't override them. */
export const RESERVED_ENV_KEYS = ['PORT'] as const;

/** Variable name. */
export const EnvKeySchema = z
  .string()
  .trim()
  .min(1, 'Enter a name.')
  .max(128, 'Use at most 128 characters.')
  .regex(ENV_KEY_PATTERN, 'Use letters, digits and _ (not starting with a digit).')
  .refine((key) => !(RESERVED_ENV_KEYS as readonly string[]).includes(key), {
    message: 'PORT is set by Selfship from the project settings.',
  });

/** Variable value (may be multiline). */
export const EnvValueSchema = z
  .string()
  .max(32 * 1024, 'Values can be at most 32 KB.')
  .refine((value) => !value.includes('\0'), 'Values cannot contain NUL bytes.');

/** One variable to create or update. */
export const EnvVarInputSchema = z.object({
  key: EnvKeySchema,
  value: EnvValueSchema,
  scope: EnvScopeSchema,
});
export type EnvVarInput = z.infer<typeof EnvVarInputSchema>;

/** Body of `PUT /projects/:id/env`: create or update several at once (e.g. a pasted .env). */
export const UpsertEnvVarsSchema = z.object({
  vars: z
    .array(EnvVarInputSchema)
    .min(1, 'Add at least one variable.')
    .max(200, 'At most 200 variables at a time.')
    .refine((vars) => new Set(vars.map((v) => v.key)).size === vars.length, {
      message: 'Each name may appear only once.',
    }),
});
export type UpsertEnvVarsInput = z.infer<typeof UpsertEnvVarsSchema>;

/** Body of `PATCH /projects/:id/env/:key`: change the scope without re-entering the value. */
export const UpdateEnvVarSchema = z.object({ scope: EnvScopeSchema });
export type UpdateEnvVarInput = z.infer<typeof UpdateEnvVarSchema>;

/** A variable as listed: never includes the value (see the reveal endpoint). */
export interface EnvVarDto {
  key: string;
  scope: EnvScope;
  updatedAt: string;
}

/** Response of `GET /projects/:id/env`. */
export interface EnvVarListResponse {
  items: EnvVarDto[];
}

/** Response of `GET /projects/:id/env/:key/value`. */
export interface EnvVarValueResponse {
  key: string;
  value: string;
}
