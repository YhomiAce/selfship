import type { GithubInstallation, Project } from '@selfship/db';
import type { GithubConnectionState, ProjectDto } from '@selfship/shared';

/** A project with its GitHub installation loaded. */
export type ProjectWithInstallation = Project & { githubInstallation: GithubInstallation };

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
 * @param project - Project with its installation
 * @returns DTO for the API
 */
export function toProjectDto(project: ProjectWithInstallation): ProjectDto {
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
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}
