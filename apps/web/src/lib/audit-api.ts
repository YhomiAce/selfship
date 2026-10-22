import type { AuditEventListResponse } from '@selfship/shared';
import { apiFetch } from '@/lib/api-client';

/** Typed wrapper around the API's activity log. */
export const auditApi = {
  /** Recent events, newest first; pass the previous `nextCursor` for older ones. */
  list: (before?: string): Promise<AuditEventListResponse> =>
    apiFetch(`/audit-events${before ? `?before=${encodeURIComponent(before)}` : ''}`),
};
