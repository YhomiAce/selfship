import { BadRequestException, Injectable } from '@nestjs/common';
import type { TokenPurpose } from '@selfship/db';
import { AuthErrorCode } from '@selfship/shared';
import { generateToken, hashToken } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';

/** Creates and consumes single-use email tokens (verification, password reset). */
@Injectable()
export class TokenService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Issues a new token, invalidating any unused token of the same purpose, so
   * only the most recent email link works.
   *
   * @param userId - Owner of the token
   * @param purpose - What the token can be used for
   * @param ttlMs - Lifetime in milliseconds
   * @returns The raw token, to be put in the email link (never stored)
   */
  async issue(userId: string, purpose: TokenPurpose, ttlMs: number): Promise<string> {
    const token = generateToken();
    await this.prisma.$transaction([
      this.prisma.verificationToken.deleteMany({ where: { userId, purpose, usedAt: null } }),
      this.prisma.verificationToken.create({
        data: {
          userId,
          purpose,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + ttlMs),
        },
      }),
    ]);
    return token;
  }

  /**
   * Validates and marks a token as used, atomically, so a link works once.
   *
   * @param token - Raw token from the email link
   * @param purpose - Expected purpose
   * @returns The ID of the user the token belongs to
   * @throws {BadRequestException} `INVALID_TOKEN` if unknown, expired, used or of another purpose
   */
  async consume(token: string, purpose: TokenPurpose): Promise<string> {
    const record = await this.prisma.verificationToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });

    if (record?.purpose === purpose && record.usedAt === null && record.expiresAt > new Date()) {
      // Conditional update guards against two concurrent requests using the same link.
      const { count } = await this.prisma.verificationToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (count === 1) return record.userId;
    }

    throw new BadRequestException({
      code: AuthErrorCode.INVALID_TOKEN,
      message: 'This link is invalid or has expired. Please request a new one.',
    });
  }
}
