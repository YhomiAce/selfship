import type { AddDomainInput, DomainDto, DomainListResponse } from '@selfship/shared';
import { apiFetch } from '@/lib/api-client';

const base = (projectId: string): string => `/projects/${encodeURIComponent(projectId)}/domains`;

/** Typed wrappers around the API's domain endpoints. */
export const domainsApi = {
  /** Domains with the DNS records to create. */
  list: async (projectId: string): Promise<DomainDto[]> =>
    (await apiFetch<DomainListResponse>(base(projectId))).items,

  /** Adds a custom domain; returns all domains. */
  add: async (projectId: string, input: AddDomainInput): Promise<DomainDto[]> =>
    (await apiFetch<DomainListResponse>(base(projectId), { method: 'POST', json: input })).items,

  /** Checks a domain now (DNS or certificate). */
  check: (projectId: string, id: string): Promise<DomainDto> =>
    apiFetch(`${base(projectId)}/${encodeURIComponent(id)}/check`, { method: 'POST' }),

  /** Removes a custom domain. */
  remove: (projectId: string, id: string): Promise<void> =>
    apiFetch(`${base(projectId)}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
