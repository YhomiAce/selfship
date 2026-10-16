import { Injectable, NotFoundException } from '@nestjs/common';
import type { EnvVar } from '@selfship/db';
import { EnvelopeCipher } from '@selfship/crypto';
import {
  type EnvScope,
  type EnvVarDto,
  type EnvVarValueResponse,
  ErrorCode,
  type UpsertEnvVarsInput,
} from '@selfship/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Encryption context of an env var value: binds the ciphertext to its project
 * and name. Must match the worker's `envVarContext`
 * (apps/worker/src/deployments/deployment-plan.ts).
 *
 * @param projectId - Project ID
 * @param key - Variable name
 * @returns Context string
 */
export function envVarContext(projectId: string, key: string): string {
  return `project:${projectId}:env:${key}`;
}

const PROJECT_NOT_FOUND = { code: ErrorCode.NOT_FOUND, message: 'Project not found.' };

/**
 * A project's environment variables. Values are encrypted before they are
 * stored and only decrypted for "reveal" and by the worker at deploy time.
 * Changes apply to the next deployment.
 */
@Injectable()
export class EnvVarsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: EnvelopeCipher,
  ) {}

  /**
   * Lists variables (names and scopes only).
   *
   * @param userId - Signed-in user
   * @param projectId - Project ID
   * @returns Variables sorted by name
   */
  async list(userId: string, projectId: string): Promise<EnvVarDto[]> {
    await this.assertOwned(userId, projectId);
    const vars = await this.prisma.envVar.findMany({
      where: { projectId },
      orderBy: { key: 'asc' },
    });
    return vars.map(toEnvVarDto);
  }

  /**
   * Creates or replaces several variables at once (single add, or a pasted .env).
   *
   * @param userId - Signed-in user
   * @param projectId - Project ID
   * @param input - Variables
   * @returns All variables after the change
   */
  async upsert(userId: string, projectId: string, input: UpsertEnvVarsInput): Promise<EnvVarDto[]> {
    await this.assertOwned(userId, projectId);
    await this.prisma.$transaction(
      input.vars.map(({ key, value, scope }) => {
        const encryptedValue = this.cipher.encrypt(value, envVarContext(projectId, key));
        return this.prisma.envVar.upsert({
          where: { projectId_key: { projectId, key } },
          create: { projectId, key, scope, encryptedValue },
          update: { scope, encryptedValue },
        });
      }),
    );
    return this.list(userId, projectId);
  }

  /**
   * Changes when a variable is available, keeping its value.
   *
   * @param userId - Signed-in user
   * @param projectId - Project ID
   * @param key - Variable name
   * @param scope - New scope
   * @returns The variable
   * @throws {NotFoundException} If the variable doesn't exist
   */
  async updateScope(
    userId: string,
    projectId: string,
    key: string,
    scope: EnvScope,
  ): Promise<EnvVarDto> {
    const envVar = await this.findOwned(userId, projectId, key);
    return toEnvVarDto(
      await this.prisma.envVar.update({ where: { id: envVar.id }, data: { scope } }),
    );
  }

  /**
   * Returns a variable's value (the "reveal" button).
   *
   * @param userId - Signed-in user
   * @param projectId - Project ID
   * @param key - Variable name
   * @returns Name and decrypted value
   * @throws {NotFoundException} If the variable doesn't exist
   */
  async reveal(userId: string, projectId: string, key: string): Promise<EnvVarValueResponse> {
    const envVar = await this.findOwned(userId, projectId, key);
    return {
      key,
      value: this.cipher.decrypt(envVar.encryptedValue, envVarContext(projectId, key)),
    };
  }

  /**
   * Deletes a variable.
   *
   * @param userId - Signed-in user
   * @param projectId - Project ID
   * @param key - Variable name
   * @throws {NotFoundException} If the variable doesn't exist
   */
  async remove(userId: string, projectId: string, key: string): Promise<void> {
    const envVar = await this.findOwned(userId, projectId, key);
    await this.prisma.envVar.delete({ where: { id: envVar.id } });
  }

  /** 404 unless the project exists and belongs to the user. */
  private async assertOwned(userId: string, projectId: string): Promise<void> {
    const count = await this.prisma.project.count({ where: { id: projectId, userId } });
    if (count === 0) throw new NotFoundException(PROJECT_NOT_FOUND);
  }

  /** Loads a variable of a project owned by the user. */
  private async findOwned(userId: string, projectId: string, key: string): Promise<EnvVar> {
    await this.assertOwned(userId, projectId);
    const envVar = await this.prisma.envVar.findUnique({
      where: { projectId_key: { projectId, key } },
    });
    if (!envVar) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: `Variable ${key} not found.`,
      });
    }
    return envVar;
  }
}

/** Public shape of a variable (no value). */
function toEnvVarDto(envVar: EnvVar): EnvVarDto {
  return { key: envVar.key, scope: envVar.scope, updatedAt: envVar.updatedAt.toISOString() };
}
