import type {
  CreateDeploymentInput,
  DeploymentDto,
  DeploymentListResponse,
} from '@selfship/shared';
import { apiFetch } from '@/lib/api-client';

/** Base path of a project's deployments. */
const base = (projectId: string): string =>
  `/projects/${encodeURIComponent(projectId)}/deployments`;

/** Typed wrappers around the API's deployment endpoints. */
export const deploymentsApi = {
  /** Deploys the latest commit of the project's branch, or the given commit. */
  create: (projectId: string, input: CreateDeploymentInput = {}): Promise<DeploymentDto> =>
    apiFetch(base(projectId), { method: 'POST', json: input }),

  /** Puts an earlier deployment's image live again (no rebuild). */
  rollback: (projectId: string, id: string): Promise<DeploymentDto> =>
    apiFetch(`${base(projectId)}/${encodeURIComponent(id)}/rollback`, { method: 'POST' }),

  /** Recent deployments, newest first. */
  list: async (projectId: string): Promise<DeploymentDto[]> =>
    (await apiFetch<DeploymentListResponse>(base(projectId))).items,

  /** One deployment. */
  get: (projectId: string, id: string): Promise<DeploymentDto> =>
    apiFetch(`${base(projectId)}/${encodeURIComponent(id)}`),

  /** Cancels a queued or running deployment. */
  cancel: (projectId: string, id: string): Promise<DeploymentDto> =>
    apiFetch(`${base(projectId)}/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),

  /** Server-Sent Events URL for the live log. */
  streamUrl: (projectId: string, id: string): string =>
    `/api${base(projectId)}/${encodeURIComponent(id)}/stream`,
};
