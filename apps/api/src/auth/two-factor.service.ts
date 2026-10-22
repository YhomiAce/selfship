import { randomInt } from 'node:crypto';
import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { User } from '@selfship/db';
import { EnvelopeCipher } from '@selfship/crypto';
import {
  AuthErrorCode,
  type RecoveryCodesResponse,
  type TwoFactorSetupResponse,
  type TwoFactorVerifyInput,
} from '@selfship/shared';
import { AuditService } from '../audit/audit.service';
import { hashToken } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RECOVERY_CODE_COUNT } from './auth.constants';
import { TokenService } from './token.service';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp';

/** Encryption context of a user's TOTP secret. */
function totpContext(userId: string): string {
  return `user:${userId}:totp`;
}

/** Letters and digits without look-alikes (0/o, 1/l) for recovery codes. */
const RECOVERY_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

const INVALID_CODE = {
  code: AuthErrorCode.TWO_FACTOR_INVALID,
  message:
    "That code didn't work. Check the time on your phone is correct, or use a recovery code.",
};

/**
 * Two-factor authentication with an authenticator app (TOTP, RFC 6238):
 * setup, enabling with recovery codes, the second sign-in step, disabling.
 */
@Injectable()
export class TwoFactorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: EnvelopeCipher,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Starts setup: a new secret for the authenticator app. Two-factor stays
   * off until a code from the app is confirmed with {@link enable}.
   *
   * @param user - Signed-in user
   * @returns The `otpauth://` URI (QR code) and the secret for manual entry
   * @throws {ConflictException} `TWO_FACTOR_ALREADY_ENABLED`
   */
  async setup(user: User): Promise<TwoFactorSetupResponse> {
    if (user.totpEnabledAt) {
      throw new ConflictException({
        code: AuthErrorCode.TWO_FACTOR_ALREADY_ENABLED,
        message: 'Two-factor authentication is already on.',
      });
    }
    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { totpSecret: this.cipher.encrypt(secret, totpContext(user.id)), totpLastStep: null },
    });
    return { otpauthUri: otpauthUri('Selfship', user.email, secret), secret };
  }

  /**
   * Turns two-factor on after the user proves the app works.
   *
   * @param user - Signed-in user
   * @param code - Current code from the app
   * @returns Recovery codes (shown once)
   * @throws {UnauthorizedException} `TWO_FACTOR_INVALID`
   */
  async enable(user: User, code: string): Promise<RecoveryCodesResponse> {
    if (user.totpEnabledAt) {
      throw new ConflictException({
        code: AuthErrorCode.TWO_FACTOR_ALREADY_ENABLED,
        message: 'Two-factor authentication is already on.',
      });
    }
    if (!user.totpSecret) throw new UnauthorizedException(INVALID_CODE);
    const step = verifyTotp(this.cipher.decrypt(user.totpSecret, totpContext(user.id)), code, null);
    if (step === null) throw new UnauthorizedException(INVALID_CODE);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { totpEnabledAt: new Date(), totpLastStep: step },
    });
    await this.audit.record(user.id, 'auth.two_factor_enabled');
    return { recoveryCodes: await this.replaceRecoveryCodes(user.id) };
  }

  /**
   * Turns two-factor off.
   *
   * @param user - Signed-in user
   * @param code - Current code from the app
   * @throws {UnauthorizedException} `TWO_FACTOR_INVALID`
   */
  async disable(user: User, code: string): Promise<void> {
    await this.requireCode(user, code);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null },
      }),
      this.prisma.recoveryCode.deleteMany({ where: { userId: user.id } }),
    ]);
    await this.audit.record(user.id, 'auth.two_factor_disabled');
  }

  /**
   * Replaces the recovery codes (the old ones stop working).
   *
   * @param user - Signed-in user
   * @param code - Current code from the app
   * @returns New recovery codes (shown once)
   */
  async regenerateRecoveryCodes(user: User, code: string): Promise<RecoveryCodesResponse> {
    await this.requireCode(user, code);
    await this.audit.record(user.id, 'auth.recovery_codes_regenerated');
    return { recoveryCodes: await this.replaceRecoveryCodes(user.id) };
  }

  /**
   * Second step of a sign-in: checks the code (or a recovery code) for the
   * pending challenge. The challenge is used up only on success, so a typo
   * can be retried (attempts are rate limited per IP).
   *
   * @param challenge - Token from the challenge cookie
   * @param input - App code or recovery code
   * @returns The user, ready for a session
   * @throws {UnauthorizedException} `TWO_FACTOR_INVALID` (also for an expired challenge)
   */
  async completeSignIn(challenge: string, input: TwoFactorVerifyInput): Promise<User> {
    const userId = await this.tokens.peek(challenge, 'TWO_FACTOR_LOGIN');
    const user = userId ? await this.prisma.user.findUnique({ where: { id: userId } }) : null;
    if (!user?.totpEnabledAt || !user.totpSecret) {
      throw new UnauthorizedException({
        code: AuthErrorCode.TWO_FACTOR_INVALID,
        message: 'This sign-in has expired. Enter your email and password again.',
      });
    }

    const ok =
      'code' in input
        ? await this.acceptCode(user, input.code)
        : await this.acceptRecoveryCode(user.id, input.recoveryCode);
    if (!ok) {
      await this.audit.record(user.id, 'auth.two_factor_failed');
      throw new UnauthorizedException(INVALID_CODE);
    }
    await this.tokens.consume(challenge, 'TWO_FACTOR_LOGIN');
    if ('recoveryCode' in input) await this.audit.record(user.id, 'auth.recovery_code_used');
    return user;
  }

  /** Throws unless the code is valid (and records it as used). */
  private async requireCode(user: User, code: string): Promise<void> {
    if (!user.totpEnabledAt) {
      throw new ConflictException({
        code: AuthErrorCode.TWO_FACTOR_NOT_ENABLED,
        message: 'Two-factor authentication is off.',
      });
    }
    if (!(await this.acceptCode(user, code))) throw new UnauthorizedException(INVALID_CODE);
  }

  /**
   * Checks an app code and stores its time step, atomically, so the same
   * code can't be used twice (even by two requests at once).
   */
  private async acceptCode(user: User, code: string): Promise<boolean> {
    if (!user.totpSecret) return false;
    const step = verifyTotp(
      this.cipher.decrypt(user.totpSecret, totpContext(user.id)),
      code,
      user.totpLastStep,
    );
    if (step === null) return false;
    const { count } = await this.prisma.user.updateMany({
      where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
      data: { totpLastStep: step },
    });
    return count === 1;
  }

  /** Uses up a recovery code, if it exists and is unused. */
  private async acceptRecoveryCode(userId: string, code: string): Promise<boolean> {
    const { count } = await this.prisma.recoveryCode.updateMany({
      where: { userId, codeHash: hashToken(code), usedAt: null },
      data: { usedAt: new Date() },
    });
    return count === 1;
  }

  /** Creates fresh recovery codes (stores only their hashes). */
  private async replaceRecoveryCodes(userId: string): Promise<string[]> {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
      Array.from({ length: 10 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]).join(
        '',
      ),
    );
    await this.prisma.$transaction([
      this.prisma.recoveryCode.deleteMany({ where: { userId } }),
      this.prisma.recoveryCode.createMany({
        data: codes.map((code) => ({ userId, codeHash: hashToken(code) })),
      }),
    ]);
    return codes.map((code) => `${code.slice(0, 5)}-${code.slice(5)}`);
  }
}
