import { Injectable } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import type { User } from '@platform/db';
import { generateToken, hashToken } from '../common/crypto';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { SESSION_COOKIE, SESSION_REFRESH_INTERVAL_MS } from './auth.constants';
import type { RequestContext } from './auth.types';

/** A newly created session. */
export interface CreatedSession {
  /** Raw token for the cookie. Never stored server-side. */
  token: string;
  expiresAt: Date;
}

/** Result of validating a session cookie. */
export interface ValidatedSession {
  sessionId: string;
  user: User;
  /** Set when the expiry was extended, so the cookie should be re-sent. */
  renewedExpiresAt: Date | null;
}

/**
 * Database-backed sessions with sliding expiry.
 *
 * The browser holds a random token in an httpOnly cookie; we store only its
 * hash. Sessions can be revoked individually or all at once (password reset).
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  /** Session lifetime in milliseconds. */
  private get ttlMs(): number {
    return this.config.get('SESSION_TTL_DAYS') * 24 * 60 * 60 * 1000;
  }

  /** Cookie name for the current environment. */
  get cookieName(): string {
    return this.config.isProduction ? SESSION_COOKIE.secure : SESSION_COOKIE.insecure;
  }

  /**
   * Starts a new session for a user.
   *
   * @param userId - The user signing in
   * @param context - Client IP and user agent, kept for the user's session list
   * @returns The raw token and expiry to put in the cookie
   */
  async create(userId: string, context: RequestContext): Promise<CreatedSession> {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + this.ttlMs);
    await this.prisma.session.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    });
    return { token, expiresAt };
  }

  /**
   * Looks up a session by its cookie token, extending it if due.
   *
   * @param token - Raw token from the cookie
   * @returns The session and its user, or null if unknown or expired
   */
  async validate(token: string): Promise<ValidatedSession | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!session) return null;

    const now = Date.now();
    if (session.expiresAt.getTime() <= now) {
      await this.prisma.session.deleteMany({ where: { id: session.id } });
      return null;
    }

    let renewedExpiresAt: Date | null = null;
    if (now - session.lastUsedAt.getTime() > SESSION_REFRESH_INTERVAL_MS) {
      renewedExpiresAt = new Date(now + this.ttlMs);
      await this.prisma.session.update({
        where: { id: session.id },
        data: { lastUsedAt: new Date(now), expiresAt: renewedExpiresAt },
      });
    }

    return { sessionId: session.id, user: session.user, renewedExpiresAt };
  }

  /**
   * Ends one session (logout).
   *
   * @param sessionId - Session to delete
   */
  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { id: sessionId } });
  }

  /**
   * Ends every session of a user (after a password reset or account takeover risk).
   *
   * @param userId - User whose sessions are deleted
   */
  async revokeAll(userId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { userId } });
  }

  /**
   * Reads the session token from the request cookies.
   *
   * @param req - Express request (cookie-parser must be installed)
   * @returns The raw token, or undefined
   */
  readCookie(req: Request): string | undefined {
    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    return cookies?.[this.cookieName];
  }

  /**
   * Sets the session cookie on the response.
   *
   * @param res - Express response
   * @param token - Raw session token
   * @param expiresAt - When the cookie should expire
   */
  setCookie(res: Response, token: string, expiresAt: Date): void {
    res.cookie(this.cookieName, token, { ...this.cookieOptions(), expires: expiresAt });
  }

  /**
   * Removes the session cookie from the browser.
   *
   * @param res - Express response
   */
  clearCookie(res: Response): void {
    res.clearCookie(this.cookieName, this.cookieOptions());
  }

  /** Shared cookie attributes. `SameSite=Lax` blocks cross-site POSTs. */
  private cookieOptions(): CookieOptions {
    return { httpOnly: true, secure: this.config.isProduction, sameSite: 'lax', path: '/' };
  }
}
