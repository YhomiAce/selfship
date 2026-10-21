import type { DiagnosisDto, DiagnosisFeedbackInput, DiagnosisResponse } from '@selfship/shared';
import { apiFetch } from '@/lib/api-client';

const base = (projectId: string, deploymentId: string): string =>
  `/projects/${encodeURIComponent(projectId)}/deployments/${encodeURIComponent(deploymentId)}/diagnosis`;

/** Typed wrappers around the API's Build Doctor endpoints. */
export const buildDoctorApi = {
  /** The diagnosis (if any) and whether Build Doctor is available. */
  get: (projectId: string, deploymentId: string): Promise<DiagnosisResponse> =>
    apiFetch(base(projectId, deploymentId)),

  /** Asks for a diagnosis. */
  request: (projectId: string, deploymentId: string): Promise<DiagnosisResponse> =>
    apiFetch(base(projectId, deploymentId), { method: 'POST' }),

  /** Rates a diagnosis. */
  feedback: (
    projectId: string,
    deploymentId: string,
    input: DiagnosisFeedbackInput,
  ): Promise<DiagnosisDto> =>
    apiFetch(`${base(projectId, deploymentId)}/feedback`, { method: 'POST', json: input }),

  /** Applies the suggested settings fix. */
  apply: (projectId: string, deploymentId: string): Promise<{ applied: string }> =>
    apiFetch(`${base(projectId, deploymentId)}/apply`, { method: 'POST' }),
};
