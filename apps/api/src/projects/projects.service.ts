import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import type { GithubInstallation, Prisma } from '@selfship/db';
import { detectProject, fallbackSettings } from '@selfship/adapters';
import { githubRepoSnapshot, RootDirectoryNotFoundError } from '@selfship/github';
import {
  ACTIVE_DEPLOYMENT_STATUSES,
  type CreateProjectInput,
  DeploymentErrorCode,
  DeploymentQueueJob,
  type DetectProjectInput,
  type DetectProjectResponse,
  ErrorCode,
  ProjectErrorCode,
  type ProjectDto,
  type ProjectSettings,
  QueueName,
  type TeardownJobData,
  type UpdateProjectInput,
} from '@selfship/shared';
import { DEPLOYMENT_INCLUDE, toDeploymentDto } from '../deployments/deployment.mapper';
import { isUniqueViolation } from '../common/prisma-errors';
import { GithubAppService } from '../github/github-app.service';
import { toGithubId } from '../github/github.constants';
import { GithubInstallationsService } from '../github/github-installations.service';
import { PrismaService } from '../prisma/prisma.service';
import { PROJECT_INCLUDE, type ProjectWithRelations, toProjectDto } from './project.mapper';

/** 404 used whenever a project doesn't exist or belongs to someone else. */
const PROJECT_NOT_FOUND = { code: ErrorCode.NOT_FOUND, message: 'Project not found.' };

/** Error mapping for "this repository isn't reachable through the app". */
const REPO_NOT_ACCESSIBLE = {
  code: ProjectErrorCode.REPO_NOT_ACCESSIBLE,
  message: "This repository doesn't exist or the Selfship app can't access it.",
};

/**
 * Projects: detecting how a repository should be built, and creating,
 * listing, updating and deleting projects. Users only ever see their own.
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly github: GithubAppService,
    private readonly installations: GithubInstallationsService,
    @InjectQueue(QueueName.DEPLOYMENTS) private readonly deploymentsQueue: Queue<TeardownJobData>,
  ) {}

  /**
   * Looks at a repository folder through the GitHub API and suggests build
   * settings, without cloning anything.
   *
   * @param userId - Signed-in user
   * @param input - Installation, repository, branch and folder
   * @returns Detected adapter (or null) with suggested settings
   * @throws {NotFoundException} If the installation or repository isn't accessible
   * @throws {BadRequestException} `ROOT_DIRECTORY_NOT_FOUND` if the folder doesn't exist
   */
  async detect(userId: string, input: DetectProjectInput): Promise<DetectProjectResponse> {
    const installation = await this.installations.getForUser(userId, input.installationId);
    const githubId = toGithubId(installation.githubInstallationId);

    try {
      const snapshot = await githubRepoSnapshot(
        this.github.client,
        githubId,
        input.repoFullName,
        input.branch,
        input.rootDirectory,
      );
      const result = await detectProject(snapshot);
      if (result) {
        return {
          adapter: result.adapter,
          reason: result.reason,
          settings: result.settings,
          packageManager: result.packageManager,
        };
      }
      return {
        adapter: null,
        reason:
          "We couldn't tell what kind of project this is. Pick the type below, or add a Dockerfile to the repository.",
        settings: fallbackSettings(),
        packageManager: null,
      };
    } catch (error) {
      if (error instanceof RootDirectoryNotFoundError)
        throw rootDirectoryNotFound(input.rootDirectory);
      throw this.github.toHttpError(error, REPO_NOT_ACCESSIBLE);
    }
  }

  /**
   * Creates a project after checking, through GitHub, that the repository,
   * branch and folder really exist and are accessible.
   *
   * @param userId - Signed-in user
   * @param input - Name, source and settings
   * @returns The new project
   * @throws {ConflictException} `PROJECT_NAME_TAKEN` if the user already has a project with that name
   * @throws {BadRequestException} `BRANCH_NOT_FOUND` / `ROOT_DIRECTORY_NOT_FOUND`
   * @throws {NotFoundException} If the installation or repository isn't accessible
   */
  async create(userId: string, input: CreateProjectInput): Promise<ProjectDto> {
    const installation = await this.installations.getForUser(userId, input.source.installationId);
    const repository = await this.verifySource(
      installation,
      input.source.repoFullName,
      input.source.branch,
      input.source.rootDirectory,
    );

    try {
      const project = await this.prisma.project.create({
        data: {
          userId,
          githubInstallationId: installation.id,
          name: input.name,
          repoId: BigInt(repository.id),
          repoFullName: repository.fullName,
          branch: input.source.branch,
          rootDirectory: input.source.rootDirectory,
          ...settingsData(input.settings),
        },
        include: PROJECT_INCLUDE,
      });
      return toProjectDto(project, { live: null, latest: null });
    } catch (error) {
      throw isUniqueViolation(error) ? nameTaken(input.name) : error;
    }
  }

  /**
   * Lists the user's projects, newest first.
   *
   * @param userId - Signed-in user
   * @returns Projects
   */
  async list(userId: string): Promise<ProjectDto[]> {
    const projects = await this.prisma.project.findMany({
      where: { userId },
      include: PROJECT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return this.withDeployments(projects);
  }

  /**
   * Fetches one of the user's projects.
   *
   * @param userId - Signed-in user
   * @param projectId - Project ID
   * @returns The project
   * @throws {NotFoundException} If missing or owned by someone else
   */
  async get(userId: string, projectId: string): Promise<ProjectDto> {
    const [dto] = await this.withDeployments([await this.findOwned(userId, projectId)]);
    if (!dto) throw new NotFoundException(PROJECT_NOT_FOUND);
    return dto;
  }

  /**
   * Updates name, branch, folder, build settings, server and/or health check
   * path. Branch and folder changes are verified against GitHub first.
   * Moving to another server leaves the app running on the old one until a
   * deployment on the new server succeeds (then the worker removes it).
   *
   * @param userId - Signed-in user
   * @param projectId - Project ID
   * @param input - Fields to change
   * @returns The updated project
   * @throws {NotFoundException} If missing or owned by someone else
   * @throws {ConflictException} `PROJECT_NAME_TAKEN`, or if GitHub access was removed
   * @throws {BadRequestException} `BRANCH_NOT_FOUND` / `ROOT_DIRECTORY_NOT_FOUND` / unknown server
   */
  async update(userId: string, projectId: string, input: UpdateProjectInput): Promise<ProjectDto> {
    const project = await this.findOwned(userId, projectId);
    const branch = input.branch ?? project.branch;
    const rootDirectory = input.rootDirectory ?? project.rootDirectory;

    if (branch !== project.branch || rootDirectory !== project.rootDirectory) {
      if (project.githubInstallation.deletedAt || project.githubInstallation.suspendedAt) {
        throw new ConflictException({
          code: 'INSTALLATION_SUSPENDED',
          message: 'Reconnect GitHub for this project before changing its branch or folder.',
        });
      }
      await this.verifySource(
        project.githubInstallation,
        project.repoFullName,
        branch,
        rootDirectory,
      );
    }

    if (input.serverId) await this.assertServerOwned(userId, input.serverId);

    const data: Prisma.ProjectUncheckedUpdateInput = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      branch,
      rootDirectory,
      ...(input.settings ? settingsData(input.settings) : {}),
      ...(input.serverId !== undefined ? { serverId: input.serverId } : {}),
      ...(input.healthCheckPath !== undefined ? { healthCheckPath: input.healthCheckPath } : {}),
      ...(input.autoDeploy !== undefined ? { autoDeploy: input.autoDeploy } : {}),
    };

    try {
      const updated = await this.prisma.project.update({
        where: { id: project.id },
        data,
        include: PROJECT_INCLUDE,
      });
      const [dto] = await this.withDeployments([updated]);
      if (!dto) throw new NotFoundException(PROJECT_NOT_FOUND);
      return dto;
    } catch (error) {
      throw isUniqueViolation(error) ? nameTaken(input.name ?? project.name) : error;
    }
  }

  /**
   * Deletes a project and removes its app from every server it ran on
   * (containers, images and files; a worker job does that over SSH).
   *
   * @param userId - Signed-in user
   * @param projectId - Project ID
   * @throws {NotFoundException} If missing or owned by someone else
   * @throws {ConflictException} `DEPLOYMENT_IN_PROGRESS` while a deployment runs
   */
  async remove(userId: string, projectId: string): Promise<void> {
    const project = await this.findOwned(userId, projectId);
    const active = await this.prisma.deployment.count({
      where: { projectId, status: { in: [...ACTIVE_DEPLOYMENT_STATUSES] } },
    });
    if (active > 0) {
      throw new ConflictException({
        code: DeploymentErrorCode.DEPLOYMENT_IN_PROGRESS,
        message: 'Cancel the running deployment (or wait for it) before deleting the project.',
      });
    }
    const servers = await this.prisma.deployment.findMany({
      // Any deployment that started may have left images or files behind.
      where: { projectId, serverId: { not: null }, startedAt: { not: null } },
      distinct: ['serverId'],
      select: { serverId: true },
    });
    await this.prisma.project.delete({ where: { id: project.id } });
    for (const { serverId } of servers) {
      if (!serverId) continue;
      await this.deploymentsQueue.add(
        DeploymentQueueJob.TEARDOWN,
        { projectId, serverId },
        { jobId: `teardown-${projectId}-${serverId}` },
      );
    }
  }

  /** Adds the live and latest deployment to each project (two queries for any number). */
  private async withDeployments(projects: ProjectWithRelations[]): Promise<ProjectDto[]> {
    const ids = projects.map((project) => project.id);
    const [live, latest] = await Promise.all([
      this.prisma.deployment.findMany({
        where: { projectId: { in: ids }, status: 'live' },
        include: DEPLOYMENT_INCLUDE,
      }),
      this.prisma.deployment.findMany({
        where: { projectId: { in: ids } },
        orderBy: { createdAt: 'desc' },
        distinct: ['projectId'],
        include: DEPLOYMENT_INCLUDE,
      }),
    ]);
    const liveBy = new Map(live.map((d) => [d.projectId, toDeploymentDto(d)]));
    const latestBy = new Map(latest.map((d) => [d.projectId, toDeploymentDto(d)]));
    return projects.map((project) =>
      toProjectDto(project, {
        live: liveBy.get(project.id) ?? null,
        latest: latestBy.get(project.id) ?? null,
      }),
    );
  }

  /** 400 unless the server exists and belongs to the user. */
  private async assertServerOwned(userId: string, serverId: string): Promise<void> {
    const count = await this.prisma.server.count({ where: { id: serverId, userId } });
    if (count === 0) {
      throw new BadRequestException({
        code: ErrorCode.NOT_FOUND,
        message: 'Server not found.',
        fieldErrors: { serverId: ['Choose one of your servers.'] },
      });
    }
  }

  /** Loads a project owned by the user, or throws 404 (never 403, to avoid leaking IDs). */
  private async findOwned(userId: string, projectId: string): Promise<ProjectWithRelations> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
      include: PROJECT_INCLUDE,
    });
    if (!project) throw new NotFoundException(PROJECT_NOT_FOUND);
    return project;
  }

  /**
   * Confirms the repository, branch and folder exist and are accessible.
   *
   * @returns The repository as reported by GitHub (canonical name and ID)
   */
  private async verifySource(
    installation: GithubInstallation,
    repoFullName: string,
    branch: string,
    rootDirectory: string,
  ): Promise<{ id: number; fullName: string }> {
    const githubId = toGithubId(installation.githubInstallationId);
    const client = this.github.client;
    try {
      const repository = await client.getRepository(githubId, repoFullName);
      if (!(await client.branchExists(githubId, repository.fullName, branch))) {
        throw new BadRequestException({
          code: ProjectErrorCode.BRANCH_NOT_FOUND,
          message: `Branch "${branch}" doesn't exist in ${repository.fullName}.`,
          fieldErrors: {
            'source.branch': ['This branch does not exist.'],
            branch: ['This branch does not exist.'],
          },
        });
      }
      if (
        rootDirectory &&
        (await client.listDirectory(githubId, repository.fullName, rootDirectory, branch)) === null
      ) {
        throw rootDirectoryNotFound(rootDirectory);
      }
      return repository;
    } catch (error) {
      throw this.github.toHttpError(error, REPO_NOT_ACCESSIBLE);
    }
  }
}

/** Maps validated settings to database columns. */
function settingsData(
  settings: ProjectSettings,
): Omit<
  Prisma.ProjectUncheckedCreateInput,
  'userId' | 'githubInstallationId' | 'name' | 'repoId' | 'repoFullName' | 'branch'
> {
  return {
    adapter: settings.adapter,
    installCommand: settings.installCommand,
    buildCommand: settings.buildCommand,
    startCommand: settings.startCommand,
    outputDirectory: settings.outputDirectory,
    port: settings.port,
    nodeVersion: settings.nodeVersion,
  };
}

/** 409 for a duplicate project name, attached to the name field. */
function nameTaken(name: string): ConflictException {
  return new ConflictException({
    code: ProjectErrorCode.PROJECT_NAME_TAKEN,
    message: `You already have a project called "${name}".`,
    fieldErrors: { name: ['You already have a project with this name.'] },
  });
}

/** 400 for a root directory that doesn't exist on the branch. */
function rootDirectoryNotFound(rootDirectory: string): BadRequestException {
  const message = `Folder "${rootDirectory || '/'}" doesn't exist on this branch.`;
  return new BadRequestException({
    code: ProjectErrorCode.ROOT_DIRECTORY_NOT_FOUND,
    message,
    fieldErrors: { 'source.rootDirectory': [message], rootDirectory: [message] },
  });
}
