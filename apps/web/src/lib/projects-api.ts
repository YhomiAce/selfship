import type {
  CreateProjectInput,
  DetectProjectInput,
  DetectProjectResponse,
  ProjectDto,
  ProjectListResponse,
  UpdateProjectInput,
} from '@selfship/shared';
import { apiFetch } from '@/lib/api-client';

/** Typed wrappers around the API's `/projects` endpoints. */
export const projectsApi = {
  /** Lists the user's projects. */
  list: async (): Promise<ProjectDto[]> => (await apiFetch<ProjectListResponse>('/projects')).items,

  /** Fetches one project. */
  get: (id: string): Promise<ProjectDto> => apiFetch(`/projects/${encodeURIComponent(id)}`),

  /** Suggests build settings for a repository folder. */
  detect: (input: DetectProjectInput): Promise<DetectProjectResponse> =>
    apiFetch('/projects/detect', { method: 'POST', json: input }),

  /** Creates a project. */
  create: (input: CreateProjectInput): Promise<ProjectDto> =>
    apiFetch('/projects', { method: 'POST', json: input }),

  /** Updates a project. */
  update: (id: string, input: UpdateProjectInput): Promise<ProjectDto> =>
    apiFetch(`/projects/${encodeURIComponent(id)}`, { method: 'PATCH', json: input }),

  /** Deletes a project. */
  remove: (id: string): Promise<void> =>
    apiFetch(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
