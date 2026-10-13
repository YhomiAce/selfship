import { z } from 'zod';

/**
 * Shape of every error response returned by the API.
 *
 * The web app relies on this contract to show messages and per-field errors,
 * so the API's global exception filter must always produce it.
 */
export const ApiErrorSchema = z.object({
  /** HTTP status code, repeated in the body for convenience. */
  statusCode: z.number().int(),
  /** Stable, machine-readable error code, e.g. `VALIDATION_FAILED`. */
  code: z.string(),
  /** Human-readable message that is safe to show to end users. */
  message: z.string(),
  /** Per-field validation messages, keyed by dotted field path. */
  fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
  /** Correlation ID for support and log lookups. */
  requestId: z.string().optional(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

/** Machine-readable error codes shared by the API and web app. */
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
