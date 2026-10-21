import type { AdapterName } from '../projects/project.schemas';

/** How long a sandbox app lives (and how much one extension adds). */
export const SANDBOX_DAYS = 7;

/** Project types allowed on shared sandbox servers (small, predictable builds). */
export const SANDBOX_ADAPTERS: readonly AdapterName[] = ['static', 'spa', 'node'];

/** Resource limits of a sandbox app's container. */
export const SANDBOX_LIMITS = { memory: '256m', cpus: '0.25', pids: 256 } as const;

/** Sandbox facts of a project. */
export interface ProjectSandbox {
  /** When the app will be removed (ISO). In the past: it was removed. */
  expiresAt: string;
  /** Already extended once. */
  extended: boolean;
  expired: boolean;
}

/** Response of `GET /sandbox`: whether the signed-in user can use the free sandbox. */
export interface SandboxStatus {
  /** Selfship has a sandbox server ready. */
  available: boolean;
  /** This user may put a project on it now. */
  eligible: boolean;
  /** Why not, in words users can act on. */
  reason: string | null;
  /** Project currently on the sandbox, if any. */
  projectId: string | null;
  /** Sandbox server to choose in "Deploy to" (the least busy one). */
  serverId: string | null;
}

/** Error codes specific to the sandbox. */
export const SandboxErrorCode = {
  SANDBOX_UNAVAILABLE: 'SANDBOX_UNAVAILABLE',
  SANDBOX_NOT_ELIGIBLE: 'SANDBOX_NOT_ELIGIBLE',
  SANDBOX_ADAPTER: 'SANDBOX_ADAPTER',
  SANDBOX_ALREADY_EXTENDED: 'SANDBOX_ALREADY_EXTENDED',
  SANDBOX_CUSTOM_DOMAIN: 'SANDBOX_CUSTOM_DOMAIN',
} as const;
