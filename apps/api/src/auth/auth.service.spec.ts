import { UnauthorizedException } from '@nestjs/common';
import type { User } from '@selfship/db';
import type { AppConfigService } from '../config/app-config.service';
import type { MailService } from '../mail/mail.service';
import type { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { GithubOAuthError, type GithubProfile } from './github-oauth.service';
import type { PasswordService } from './password.service';
import type { SessionService } from './session.service';
import type { TokenService } from './token.service';

/** Builds a database user with sensible defaults. */
function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'ada@example.com',
    name: 'Ada',
    passwordHash: 'hash',
    emailVerifiedAt: new Date(),
    avatarUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('AuthService', () => {
  const prisma = {
    user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    oAuthAccount: { findUnique: jest.fn(), update: jest.fn() },
  };
  const passwords = { hash: jest.fn(), verify: jest.fn(), needsRehash: jest.fn() };
  const sessions = { create: jest.fn(), revokeAll: jest.fn() };
  const tokens = { issue: jest.fn(), consume: jest.fn() };
  const mail = { send: jest.fn() };
  const config = { get: jest.fn().mockReturnValue('http://localhost:3000') };
  const context = { ipAddress: '127.0.0.1', userAgent: 'jest' };
  const session = { token: 'tok', expiresAt: new Date() };

  const service = new AuthService(
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordService,
    sessions as unknown as SessionService,
    tokens as unknown as TokenService,
    mail as unknown as MailService,
    config as unknown as AppConfigService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    sessions.create.mockResolvedValue(session);
  });

  describe('login', () => {
    it('gives the same error for an unknown email and a wrong password', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      passwords.verify.mockResolvedValue(false);
      const unknown = service.login({ email: 'x@y.co', password: 'pw' }, context);
      await expect(unknown).rejects.toBeInstanceOf(UnauthorizedException);

      prisma.user.findUnique.mockResolvedValueOnce(makeUser());
      const wrong = service.login({ email: 'ada@example.com', password: 'pw' }, context);
      await expect(wrong).rejects.toBeInstanceOf(UnauthorizedException);

      // The unknown-user path still runs a (dummy) hash verification.
      expect(passwords.verify).toHaveBeenNthCalledWith(1, null, 'pw');
    });

    it('rejects GitHub-only accounts that have no password', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser({ passwordHash: null }));
      passwords.verify.mockResolvedValue(false);
      await expect(
        service.login({ email: 'ada@example.com', password: 'pw' }, context),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('loginWithGithub', () => {
    const profile: GithubProfile = {
      id: '42',
      login: 'ada',
      name: 'Ada',
      verifiedEmail: 'ada@example.com',
      avatarUrl: 'https://avatars/ada',
    };

    it('signs in the linked user', async () => {
      const user = makeUser();
      prisma.oAuthAccount.findUnique.mockResolvedValue({ id: 'oa1', userId: user.id, user });

      const result = await service.loginWithGithub(profile, context);

      expect(result.user).toBe(user);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('creates a verified account for a new GitHub user', async () => {
      prisma.oAuthAccount.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(({ data }: { data: Partial<User> }) =>
        Promise.resolve(makeUser({ ...data, passwordHash: null })),
      );

      await service.loginWithGithub(profile, context);

      const created = prisma.user.create.mock.calls[0][0].data;
      expect(created.email).toBe('ada@example.com');
      expect(created.emailVerifiedAt).toBeInstanceOf(Date);
    });

    it('wipes the password and sessions when linking to an unverified account', async () => {
      prisma.oAuthAccount.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(makeUser({ emailVerifiedAt: null }));
      prisma.user.update.mockResolvedValue(makeUser());

      await service.loginWithGithub(profile, context);

      expect(sessions.revokeAll).toHaveBeenCalledWith('user-1');
      expect(prisma.user.update.mock.calls[0][0].data.passwordHash).toBeNull();
    });

    it('keeps the password when linking to a verified account', async () => {
      prisma.oAuthAccount.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(makeUser());
      prisma.user.update.mockResolvedValue(makeUser());

      await service.loginWithGithub(profile, context);

      expect(sessions.revokeAll).not.toHaveBeenCalled();
      expect(prisma.user.update.mock.calls[0][0].data).not.toHaveProperty('passwordHash');
    });

    it('refuses new accounts without a verified email', async () => {
      prisma.oAuthAccount.findUnique.mockResolvedValue(null);
      await expect(
        service.loginWithGithub({ ...profile, verifiedEmail: null }, context),
      ).rejects.toBeInstanceOf(GithubOAuthError);
    });
  });

  describe('forgotPassword', () => {
    it('does nothing (and does not throw) for unknown emails', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await service.forgotPassword({ email: 'nobody@example.com' });
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('emails a reset link to existing users', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());
      tokens.issue.mockResolvedValue('reset-token');

      await service.forgotPassword({ email: 'ada@example.com' });

      expect(mail.send).toHaveBeenCalledWith(
        expect.objectContaining({
          template: 'reset-password',
          data: expect.objectContaining({
            resetUrl: 'http://localhost:3000/reset-password?token=reset-token',
          }),
        }),
      );
    });
  });
});
