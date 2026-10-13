import { z } from 'zod';

/** Status of a single dependency checked by the health endpoint. */
export const DependencyStatusSchema = z.enum(['up', 'down']);

/** Response body of `GET /health`. */
export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  uptimeSeconds: z.number(),
  dependencies: z.object({
    database: DependencyStatusSchema,
    redis: DependencyStatusSchema,
  }),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
