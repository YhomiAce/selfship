import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/**
 * Verifies the `X-Hub-Signature-256` header GitHub sends with every webhook:
 * an HMAC-SHA256 of the raw request body, keyed with the webhook secret.
 *
 * @param secret - Webhook secret configured on the GitHub App
 * @param rawBody - Exact request body bytes (not re-serialised JSON)
 * @param signatureHeader - Header value, e.g. `sha256=abc123…`
 * @returns True only for a valid signature
 */
export function verifyWebhookSignature(
  secret: string,
  rawBody: Buffer,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const expected = Buffer.from(
    `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`,
  );
  const received = Buffer.from(signatureHeader);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/** Account (user/org) owning an installation, as sent in webhooks. */
export const WebhookAccountSchema = z.object({
  login: z.string(),
  type: z.string(),
  avatar_url: z.string().nullable().optional(),
});

/** Installation object inside webhook payloads. */
export const WebhookInstallationSchema = z.object({
  id: z.number().int().positive(),
  account: WebhookAccountSchema.nullable(),
  repository_selection: z.enum(['all', 'selected']).catch('selected'),
  suspended_at: z.string().nullable().optional(),
});

/** `installation` event (created, deleted, suspend, unsuspend, new_permissions_accepted). */
export const InstallationEventSchema = z.object({
  action: z.string(),
  installation: WebhookInstallationSchema,
});
export type InstallationEvent = z.infer<typeof InstallationEventSchema>;

/** `installation_repositories` event (repos added to / removed from an installation). */
export const InstallationRepositoriesEventSchema = z.object({
  action: z.string(),
  installation: WebhookInstallationSchema,
  repository_selection: z.enum(['all', 'selected']).catch('selected'),
});
export type InstallationRepositoriesEvent = z.infer<typeof InstallationRepositoriesEventSchema>;

/** `push` event (only the fields auto-deploy uses). */
export const PushEventSchema = z.object({
  /** e.g. `refs/heads/main` (tags are `refs/tags/…`). */
  ref: z.string(),
  /** SHA the ref points to now (all zeros when the branch was deleted). */
  after: z.string(),
  deleted: z.boolean().optional(),
  repository: z.object({ id: z.number(), full_name: z.string() }),
  installation: z.object({ id: z.number() }).optional(),
  head_commit: z
    .object({
      id: z.string(),
      message: z.string(),
      author: z.object({ name: z.string().optional(), username: z.string().optional() }).optional(),
    })
    .nullable()
    .optional(),
});
export type PushEvent = z.infer<typeof PushEventSchema>;
