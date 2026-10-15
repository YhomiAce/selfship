import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { GithubInstallation, Prisma } from '@selfship/db';
import { detectProject, fallbackSettings } from '@selfship/adapters';
import { githubRepoSnapshot, RootDirectoryNotFoundError } from '@selfship/github';
import {
  type CreateProjectInput,
  type DetectProjectInput,
  type DetectProjectResponse,
  ErrorCode,
  ProjectErrorCode,
  type ProjectDto,
  type ProjectSettings,
  type UpdateProjectInput,
} from '@selfship/shared';
import { isUniqueViolation } from '../common/prisma-errors';
import { GithubAppService } from '../github/github-app.service';
import { toGithubId } from '../github/github.constants';
import { GithubInstallationsService } from '../github/github-installations.service';
import { PrismaService } from '../prisma/prisma.service';
import { type ProjectWithInstallation, toProjectDto } from './project.mapper';

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
        include: { githubInstallation: true },
      });
      return toProjectDto(project);
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
      include: { githubInstallation: true },
      orderBy: { createdAt: 'desc' },
    });
    return projects.map(toProjectDto);
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
    return toProjectDto(await this.findOwned(userId, projectId));
  }

  /**
   * Updates name, branch, folder and/or build settings. Branch and folder
   * changes are verified against GitHub first.
   *
   * @param userId - Signed-in user
   * @param projectId - Project ID
   * @param input - Fields to change
   * @returns The updated project
   * @throws {NotFoundException} If missing or owned by someone else
   * @throws {ConflictException} `PROJECT_NAME_TAKEN`, or if GitHub access was removed
   * @throws {BadRequestException} `BRANCH_NOT_FOUND` / `ROOT_DIRECTORY_NOT_FOUND`
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

    const data: Prisma.ProjectUpdateInput = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      branch,
      rootDirectory,
      ...(input.settings ? settingsData(input.settings) : {}),
    };

    try {
      const updated = await this.prisma.project.update({
        where: { id: project.id },
        data,
        include: { githubInstallation: true },
      });
      return toProjectDto(updated);
    } catch (error) {
      throw isUniqueViolation(error) ? nameTaken(input.name ?? project.name) : error;
    }
  }

  /**
   * Deletes a project. (Nothing is deployed yet, so there is nothing to tear down.)
   *
   * @param userId - Signed-in user
   * @param projectId - Project ID
   * @throws {NotFoundException} If missing or owned by someone else
   */
  async remove(userId: string, projectId: string): Promise<void> {
    const { count } = await this.prisma.project.deleteMany({ where: { id: projectId, userId } });
    if (count === 0) throw new NotFoundException(PROJECT_NOT_FOUND);
  }

  /** Loads a project owned by the user, or throws 404 (never 403, to avoid leaking IDs). */
  private async findOwned(userId: string, projectId: string): Promise<ProjectWithInstallation> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
      include: { githubInstallation: true },
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
