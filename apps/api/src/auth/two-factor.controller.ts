import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { createZodDto, ZodValidationPipe } from 'nestjs-zod';
import type { User } from '@selfship/db';
import {
  AuthErrorCode,
  type AuthUserResponse,
  type RecoveryCodesResponse,
  TwoFactorCodeSchema,
  type TwoFactorSetupResponse,
  type TwoFactorVerifyInput,
  TwoFactorVerifySchema,
} from '@selfship/shared';
import { AuditService } from '../audit/audit.service';
import { readCookie } from '../common/http';
import { AUTH_THROTTLE, TWO_FACTOR_COOKIE } from './auth.constants';
import { requestContext } from './auth.types';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { SessionService } from './session.service';
import { TwoFactorService } from './two-factor.service';
import { toUserDto } from './user.mapper';

/** Body with the current authenticator code. */
class TwoFactorCodeDto extends createZodDto(TwoFactorCodeSchema) {}

/** Two-factor authentication: the second sign-in step and its settings. */
@Controller('auth/2fa')
export class TwoFactorController {
  constructor(
    private readonly twoFactor: TwoFactorService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Second step of sign-in: the code from the app (or a recovery code) for
   * the challenge in the cookie set by `POST /auth/login` or GitHub sign-in.
   *
   * @param body - `{ code }` or `{ recoveryCode }`
   * @returns The user (session cookie is set)
   */
  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verify(
    // A union of two shapes, so it's validated with the schema directly.
    @Body(new ZodValidationPipe(TwoFactorVerifySchema)) body: TwoFactorVerifyInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthUserResponse> {
    const challenge = readCookie(req, TWO_FACTOR_COOKIE);
    if (!challenge) {
      throw new UnauthorizedException({
        code: AuthErrorCode.TWO_FACTOR_INVALID,
        message: 'This sign-in has expired. Enter your email and password again.',
      });
    }
    const user = await this.twoFactor.completeSignIn(challenge, body);
    const session = await this.sessions.create(user.id, requestContext(req));
    await this.audit.record(user.id, 'auth.login', undefined, {
      method: 'recoveryCode' in body ? 'recovery code' : 'two-factor',
    });
    res.clearCookie(TWO_FACTOR_COOKIE, { path: '/' });
    this.sessions.setCookie(res, session.token, session.expiresAt);
    return { user: toUserDto(user) };
  }

  /**
   * Starts setup: the secret and QR code URI for an authenticator app.
   *
   * @returns URI and secret
   */
  @Throttle(AUTH_THROTTLE)
  @Post('setup')
  @HttpCode(HttpStatus.OK)
  setup(@CurrentUser() user: User): Promise<TwoFactorSetupResponse> {
    return this.twoFactor.setup(user);
  }

  /**
   * Turns two-factor on with a code from the app.
   *
   * @param body - Current code
   * @returns Recovery codes (shown once)
   */
  @Throttle(AUTH_THROTTLE)
  @Post('enable')
  @HttpCode(HttpStatus.OK)
  enable(
    @CurrentUser() user: User,
    @Body() body: TwoFactorCodeDto,
  ): Promise<RecoveryCodesResponse> {
    return this.twoFactor.enable(user, body.code);
  }

  /**
   * Turns two-factor off.
   *
   * @param body - Current code
   */
  @Throttle(AUTH_THROTTLE)
  @Post('disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  disable(@CurrentUser() user: User, @Body() body: TwoFactorCodeDto): Promise<void> {
    return this.twoFactor.disable(user, body.code);
  }

  /**
   * Replaces the recovery codes.
   *
   * @param body - Current code
   * @returns New recovery codes (shown once)
   */
  @Throttle(AUTH_THROTTLE)
  @Post('recovery-codes')
  @HttpCode(HttpStatus.OK)
  recoveryCodes(
    @CurrentUser() user: User,
    @Body() body: TwoFactorCodeDto,
  ): Promise<RecoveryCodesResponse> {
    return this.twoFactor.regenerateRecoveryCodes(user, body.code);
  }
}
