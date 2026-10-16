import type {
  EnvScope,
  EnvVarDto,
  EnvVarInput,
  EnvVarListResponse,
  EnvVarValueResponse,
} from '@selfship/shared';
import { apiFetch } from '@/lib/api-client';

const base = (projectId: string): string => `/projects/${encodeURIComponent(projectId)}/env`;

/** Typed wrappers around the API's env var endpoints. */
export const envApi = {
  /** Variables (names and scopes, no values). */
  list: async (projectId: string): Promise<EnvVarDto[]> =>
    (await apiFetch<EnvVarListResponse>(base(projectId))).items,

  /** Creates or replaces variables; returns all of them. */
  upsert: async (projectId: string, vars: EnvVarInput[]): Promise<EnvVarDto[]> =>
    (await apiFetch<EnvVarListResponse>(base(projectId), { method: 'PUT', json: { vars } })).items,

  /** Changes a variable's scope. */
  updateScope: (projectId: string, key: string, scope: EnvScope): Promise<EnvVarDto> =>
    apiFetch(`${base(projectId)}/${encodeURIComponent(key)}`, { method: 'PATCH', json: { scope } }),

  /** Reveals a value. */
  reveal: (projectId: string, key: string): Promise<EnvVarValueResponse> =>
    apiFetch(`${base(projectId)}/${encodeURIComponent(key)}/value`),

  /** Deletes a variable. */
  remove: (projectId: string, key: string): Promise<void> =>
    apiFetch(`${base(projectId)}/${encodeURIComponent(key)}`, { method: 'DELETE' }),
};
