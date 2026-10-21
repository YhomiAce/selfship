import type { ProjectSandbox, SandboxStatus } from '@selfship/shared';
import { apiFetch } from '@/lib/api-client';

/** Typed wrappers around the API's free sandbox endpoints. */
export const sandboxApi = {
  /** Whether the user can use the free sandbox, and which server to choose. */
  status: (): Promise<SandboxStatus> => apiFetch('/sandbox'),

  /** Extends a sandbox app by another week (once). */
  extend: (projectId: string): Promise<ProjectSandbox> =>
    apiFetch(`/projects/${encodeURIComponent(projectId)}/sandbox/extend`, { method: 'POST' }),
};
