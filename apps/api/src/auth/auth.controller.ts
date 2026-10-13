import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { User } from '@platform/db';
import type { AuthProvidersResponse, AuthUserResponse } from '@platform/shared';
import { generateToken, safeEqual } from '../common/crypto';
import { AppConfigService } from '../config/app-config.service';
import { AUTH_THROTTLE, OAUTH_STATE_COOKIE, OAUTH_STATE_TTL_MS } from './auth.constants';
import { AuthService, type SignedIn } from './auth.service';
import { type AuthenticatedRequest, requestContext } from './auth.types';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/auth.dto';
import { GithubOAuthService } from './github-oauth.service';
import { SessionService } from './session.service';
import { toUserDto } from './user.mapper';

/** Sign-up, sign-in, sign-out, email verification and password reset. */
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly github: GithubOAuthService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Lists enabled sign-in methods so the UI can hide unavailable buttons.
   *
   * @returns Which providers are configured
   */
  @Public()
  @Get('providers')
  providers(): AuthProvidersResponse {
    return { github: this.github.isEnabled };
  }

  /**
   * Creates an account and signs the user in.
   *
   * @param body - Name, email and password
   * @returns The new user (session cookie is set)
   */
  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('register')
  async register(
    @Body() body: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthUserResponse> {
    return this.signIn(res, await this.auth.register(body, requestContext(req)));
  }

  /**
   * Signs in with email and password.
   *
   * @param body - Email and password
   * @returns The user (session cookie is set)
   */
  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthUserResponse> {
    return this.signIn(res, await this.auth.login(body, requestContext(req)));
  }

  /**
   * Signs out the current session. Always succeeds, even without a session.
   */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    if (req.auth) await this.sessions.revoke(req.auth.sessionId);
    this.sessions.clearCookie(res);
  }

  /**
   * Returns the signed-in user.
   *
   * @returns The current user
   */
  @Get('me')
  me(@CurrentUser() user: User): AuthUserResponse {
    return { user: toUserDto(user) };
  }

  /**
   * Confirms the user's email from the verification link.
   *
   * @param body - Token from the link
   * @returns The updated user
   */
  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() body: VerifyEmailDto): Promise<AuthUserResponse> {
    return { user: toUserDto(await this.auth.verifyEmail(body.token)) };
  }

  /** Sends a new verification email to the signed-in user. */
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('resend-verification')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resendVerification(@CurrentUser() user: User): Promise<void> {
    await this.auth.resendVerification(user);
  }

  /**
   * Emails a password-reset link. Responds 204 whether or not the account exists.
   *
   * @param body - Email address
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async forgotPassword(@Body() body: ForgotPasswordDto): Promise<void> {
    await this.auth.forgotPassword(body);
  }

  /**
   * Sets a new password from a reset link and signs out all sessions.
   *
   * @param body - Token from the link and the new password
   */
  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(
    @Body() body: ResetPasswordDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.resetPassword(body);
    this.sessions.clearCookie(res);
  }

  /**
   * Starts "Sign in with GitHub": sets a CSRF state cookie and redirects to GitHub.
   *
   * @throws {NotFoundException} If GitHub sign-in isn't configured
   */
  @Public()
  @Get('github')
  githubStart(@Res() res: Response): void {
    if (!this.github.isEnabled) throw new NotFoundException();

    const state = generateToken();
    res.cookie(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: this.config.isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: OAUTH_STATE_TTL_MS,
    });
    res.redirect(this.github.authorizeUrl(state));
  }

  /**
   * GitHub redirects here after the user approves. Verifies state, signs the
   * user in and redirects to the dashboard (or back to login with an error).
   *
   * @param code - One-time authorization code
   * @param state - Must match the state cookie
   */
  @Public()
  @Throttle(AUTH_THROTTLE)
  @Get('github/callback')
  async githubCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const webUrl = this.config.get('WEB_URL');
    const cookies = req.cookies as Record<string, string | undefined>;
    const expectedState = cookies[OAUTH_STATE_COOKIE];
    res.clearCookie(OAUTH_STATE_COOKIE, { path: '/' });

    if (
      !this.github.isEnabled ||
      !code ||
      !state ||
      !expectedState ||
      !safeEqual(state, expectedState)
    ) {
      res.redirect(`${webUrl}/login?error=github`);
      return;
    }

    try {
      const profile = await this.github.fetchProfile(code);
      const signedIn = await this.auth.loginWithGithub(profile, requestContext(req));
      this.sessions.setCookie(res, signedIn.session.token, signedIn.session.expiresAt);
      res.redirect(`${webUrl}/dashboard`);
    } catch (error) {
      this.logger.warn({ err: error }, 'GitHub sign-in failed');
      res.redirect(`${webUrl}/login?error=github`);
    }
  }

  /** Sets the session cookie and returns the user DTO. */
  private signIn(res: Response, { user, session }: SignedIn): AuthUserResponse {
    this.sessions.setCookie(res, session.token, session.expiresAt);
    return { user: toUserDto(user) };
  }
}
