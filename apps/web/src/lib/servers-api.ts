import type {
  CreateServerInput,
  DeleteServerResponse,
  ServerDto,
  ServerJobDetailDto,
  ServerJobDto,
  ServerJobListResponse,
  ServerListResponse,
} from '@selfship/shared';
import { apiFetch } from '@/lib/api-client';

/** Typed wrappers around the API's `/servers` endpoints. */
export const serversApi = {
  /** Lists the user's servers. */
  list: async (): Promise<ServerDto[]> => (await apiFetch<ServerListResponse>('/servers')).items,

  /** Fetches one server. */
  get: (id: string): Promise<ServerDto> => apiFetch(`/servers/${encodeURIComponent(id)}`),

  /** Adds a server (generated key, pasted key or one-time password). */
  create: (input: CreateServerInput): Promise<ServerDto> =>
    apiFetch('/servers', { method: 'POST', json: input }),

  /** Re-inspects the server without changing it. */
  check: (id: string): Promise<ServerJobDto> =>
    apiFetch(`/servers/${encodeURIComponent(id)}/check`, { method: 'POST' }),

  /** Inspects and sets up the server (safe to repeat). */
  setup: (id: string): Promise<ServerJobDto> =>
    apiFetch(`/servers/${encodeURIComponent(id)}/setup`, { method: 'POST' }),

  /** Recent jobs, newest first. */
  jobs: async (id: string): Promise<ServerJobDto[]> =>
    (await apiFetch<ServerJobListResponse>(`/servers/${encodeURIComponent(id)}/jobs`)).items,

  /** One job including its saved log. */
  job: (id: string, jobId: string): Promise<ServerJobDetailDto> =>
    apiFetch(`/servers/${encodeURIComponent(id)}/jobs/${encodeURIComponent(jobId)}`),

  /** Server-Sent Events URL for a job's live log. */
  streamUrl: (id: string, jobId: string): string =>
    `/api/servers/${encodeURIComponent(id)}/jobs/${encodeURIComponent(jobId)}/stream`,

  /** Removes a server from Selfship; returns the revoke command. */
  remove: (id: string): Promise<DeleteServerResponse> =>
    apiFetch(`/servers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
