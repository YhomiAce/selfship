import type { GithubInstallation, Project, Server } from '@selfship/db';
import type { DeploymentDto, GithubConnectionState, ProjectDto } from '@selfship/shared';
import { sandboxFacts } from '../sandbox/sandbox.service';

/** A project with its GitHub installation and server loaded. */
export type ProjectWithRelations = Project & {
  githubInstallation: GithubInstallation;
  server: Pick<Server, 'id' | 'name' | 'status' | 'isPlatformSandbox'> | null;
};

/** Prisma include that loads what {@link toProjectDto} needs. */
export const PROJECT_INCLUDE = {
  githubInstallation: true,
  server: { select: { id: true, name: true, status: true, isPlatformSandbox: true } },
} as const;

/** The deployments shown with a project. */
export interface ProjectDeployments {
  live: DeploymentDto | null;
  latest: DeploymentDto | null;
  /** Main address of the live app. */
  url: string | null;
}

/**
 * State of the GitHub connection behind a project.
 *
 * @param installation - The project's installation
 * @returns `removed` (uninstalled), `suspended`, or `connected`
 */
export function connectionState(installation: GithubInstallation): GithubConnectionState {
  if (installation.deletedAt) return 'removed';
  if (installation.suspendedAt) return 'suspended';
  return 'connected';
}

/**
 * Converts a project record to the public DTO.
 *
 * @param project - Project with its installation and server
 * @param deployments - Live and latest deployment
 * @returns DTO for the API
 */
export function toProjectDto(
  project: ProjectWithRelations,
  deployments: ProjectDeployments,
): ProjectDto {
  return {
    id: project.id,
    name: project.name,
    repoFullName: project.repoFullName,
    branch: project.branch,
    rootDirectory: project.rootDirectory,
    settings: {
      adapter: project.adapter,
      installCommand: project.installCommand,
      buildCommand: project.buildCommand,
      startCommand: project.startCommand,
      outputDirectory: project.outputDirectory,
      port: project.port,
      nodeVersion: project.nodeVersion,
    },
    github: {
      installationId: project.githubInstallationId,
      accountLogin: project.githubInstallation.accountLogin,
      state: connectionState(project.githubInstallation),
    },
    server: project.server
      ? {
          id: project.server.id,
          name: project.server.name,
          status: project.server.status,
          sandbox: project.server.isPlatformSandbox,
        }
      : null,
    sandbox: sandboxFacts(project, project.server?.isPlatformSandbox ?? false),
    healthCheckPath: project.healthCheckPath,
    autoDeploy: project.autoDeploy,
    buildDoctor: project.buildDoctor,
    url: deployments.url,
    liveDeployment: deployments.live,
    latestDeployment: deployments.latest,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}
