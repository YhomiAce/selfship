import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { User } from '@selfship/db';
import {
  AuthErrorCode,
  type ForgotPasswordInput,
  type LoginInput,
  type RegisterInput,
  type ResetPasswordInput,
} from '@selfship/shared';
import { isUniqueViolation } from '../common/prisma-errors';
import { AppConfigService } from '../config/app-config.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { EMAIL_VERIFICATION_TTL_MS, PASSWORD_RESET_TTL_MS } from './auth.constants';
import type { RequestContext } from './auth.types';
import { GithubOAuthError, type GithubProfile } from './github-oauth.service';
import { PasswordService } from './password.service';
import { type CreatedSession, SessionService } from './session.service';
import { TokenService } from './token.service';

/** A user together with the session just created for them. */
export interface SignedIn {
  user: User;
  session: CreatedSession;
}

/**
 * Account lifecycle: sign-up, sign-in (password or GitHub), email
 * verification and password reset.
 *
 * Controllers handle cookies and HTTP; this service holds the rules.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly tokens: TokenService,
    private readonly mail: MailService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Creates an account, sends the verification email and signs the user in.
   * Unverified users can use the dashboard; sensitive actions will require
   * verification later.
   *
   * @param input - Validated sign-up form
   * @param context - Client IP and user agent
   * @returns The new user and their session
   * @throws {ConflictException} `EMAIL_TAKEN` if the email is already registered
   */
  async register(input: RegisterInput, context: RequestContext): Promise<SignedIn> {
    const passwordHash = await this.passwords.hash(input.password);

    let user: User;
    try {
      user = await this.prisma.user.create({
        data: { name: input.name, email: input.email, passwordHash },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          code: AuthErrorCode.EMAIL_TAKEN,
          message: 'An account with this email already exists. Try logging in instead.',
        });
      }
      throw error;
    }

    await this.sendVerificationEmail(user);
    const session = await this.sessions.create(user.id, context);
    return { user, session };
  }

  /**
   * Signs in with email and password.
   *
   * The error is the same for "no such user" and "wrong password", and both
   * paths take the same time, so attackers can't discover which emails exist.
   *
   * @param input - Validated login form
   * @param context - Client IP and user agent
   * @returns The user and their new session
   * @throws {UnauthorizedException} `INVALID_CREDENTIALS` on any mismatch
   */
  async login(input: LoginInput, context: RequestContext): Promise<SignedIn> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const passwordHash = user?.passwordHash ?? null;
    const valid = await this.passwords.verify(passwordHash, input.password);

    if (!user || !passwordHash || !valid) {
      throw new UnauthorizedException({
        code: AuthErrorCode.INVALID_CREDENTIALS,
        message: 'Email or password is incorrect.',
      });
    }

    if (this.passwords.needsRehash(passwordHash)) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await this.passwords.hash(input.password) },
      });
    }

    const session = await this.sessions.create(user.id, context);
    return { user, session };
  }

  /**
   * Confirms an email address from the link in the verification email.
   *
   * @param token - Token from the link
   * @returns The updated user
   * @throws {BadRequestException} `INVALID_TOKEN` if the link is invalid, used or expired
   */
  async verifyEmail(token: string): Promise<User> {
    const userId = await this.tokens.consume(token, 'EMAIL_VERIFICATION');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.emailVerifiedAt) return user;
    return this.prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date() },
    });
  }

  /**
   * Sends a fresh verification email (older links stop working).
   *
   * @param user - The signed-in user
   * @throws {ConflictException} `ALREADY_VERIFIED` if there is nothing to verify
   */
  async resendVerification(user: User): Promise<void> {
    if (user.emailVerifiedAt) {
      throw new ConflictException({
        code: AuthErrorCode.ALREADY_VERIFIED,
        message: 'Your email is already verified.',
      });
    }
    await this.sendVerificationEmail(user);
  }

  /**
   * Emails a password-reset link if the account exists. Always succeeds from
   * the caller's point of view, so it can't be used to discover accounts.
   *
   * @param input - Validated form with the email address
   */
  async forgotPassword(input: ForgotPasswordInput): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!user) return;

    const token = await this.tokens.issue(user.id, 'PASSWORD_RESET', PASSWORD_RESET_TTL_MS);
    await this.mail.send({
      template: 'reset-password',
      to: user.email,
      data: { name: user.name, resetUrl: this.webUrl('/reset-password', token) },
    });
  }

  /**
   * Sets a new password from a reset link, then signs out every session.
   * Clicking the link also proves the user owns the inbox, so the email is
   * marked verified.
   *
   * @param input - Token from the link and the new password
   * @throws {BadRequestException} `INVALID_TOKEN` if the link is invalid, used or expired
   */
  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const userId = await this.tokens.consume(input.token, 'PASSWORD_RESET');
    const passwordHash = await this.passwords.hash(input.password);

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, emailVerifiedAt: user.emailVerifiedAt ?? new Date() },
    });
    await this.sessions.revokeAll(userId);

    await this.mail.send({
      template: 'password-changed',
      to: user.email,
      data: { name: user.name },
    });
  }

  /**
   * Signs in (or signs up) with a GitHub identity.
   *
   * 1. Known GitHub account → sign in to the linked user.
   * 2. Existing user with the same (GitHub-verified) email → link and sign in.
   *    If that account was never verified, its password and sessions are wiped:
   *    otherwise someone could pre-register a victim's email, wait for the victim
   *    to sign in with GitHub, and keep access with the password they chose.
   * 3. Otherwise → create a new, already-verified account.
   *
   * @param profile - Profile returned by GitHub
   * @param context - Client IP and user agent
   * @returns The user and their new session
   * @throws {GithubOAuthError} If GitHub provided no verified email for a new account
   */
  async loginWithGithub(profile: GithubProfile, context: RequestContext): Promise<SignedIn> {
    const linked = await this.prisma.oAuthAccount.findUnique({
      where: { provider_providerAccountId: { provider: 'GITHUB', providerAccountId: profile.id } },
      include: { user: true },
    });

    if (linked) {
      await this.prisma.oAuthAccount.update({
        where: { id: linked.id },
        data: { username: profile.login },
      });
      const session = await this.sessions.create(linked.userId, context);
      return { user: linked.user, session };
    }

    if (!profile.verifiedEmail) {
      throw new GithubOAuthError('GitHub account has no verified primary email');
    }

    const existing = await this.prisma.user.findUnique({ where: { email: profile.verifiedEmail } });
    const user = existing
      ? await this.linkGithubToExistingUser(existing, profile)
      : await this.prisma.user.create({
          data: {
            email: profile.verifiedEmail,
            name: profile.name,
            avatarUrl: profile.avatarUrl,
            emailVerifiedAt: new Date(),
            oauthAccounts: {
              create: {
                provider: 'GITHUB',
                providerAccountId: profile.id,
                username: profile.login,
              },
            },
          },
        });

    const session = await this.sessions.create(user.id, context);
    return { user, session };
  }

  /** Links GitHub to an existing user, neutralising pre-registration hijacks. */
  private async linkGithubToExistingUser(user: User, profile: GithubProfile): Promise<User> {
    const wasUnverified = user.emailVerifiedAt === null;
    if (wasUnverified) {
      this.logger.warn(`Linking GitHub to unverified account ${user.id}; clearing password`);
      await this.sessions.revokeAll(user.id);
    }

    return this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        avatarUrl: user.avatarUrl ?? profile.avatarUrl,
        ...(wasUnverified ? { passwordHash: null } : {}),
        oauthAccounts: {
          create: { provider: 'GITHUB', providerAccountId: profile.id, username: profile.login },
        },
      },
    });
  }

  /** Issues a verification token and queues the email. */
  private async sendVerificationEmail(user: User): Promise<void> {
    const token = await this.tokens.issue(user.id, 'EMAIL_VERIFICATION', EMAIL_VERIFICATION_TTL_MS);
    await this.mail.send({
      template: 'verify-email',
      to: user.email,
      data: { name: user.name, verifyUrl: this.webUrl('/verify-email', token) },
    });
  }

  /** Builds an absolute web-app URL carrying a token. */
  private webUrl(path: string, token: string): string {
    const url = new URL(path, this.config.get('WEB_URL'));
    url.searchParams.set('token', token);
    return url.toString();
  }
}
