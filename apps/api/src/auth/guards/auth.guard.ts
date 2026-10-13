import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { ErrorCode } from '@selfship/shared';
import type { AuthenticatedRequest } from '../auth.types';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SessionService } from '../session.service';

/**
 * Global guard: resolves the session cookie and attaches `req.auth`.
 *
 * Routes require a session unless marked `@Public()`. Public routes still get
 * `req.auth` when a valid cookie is present (e.g. logout).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  /**
   * @param context - Nest execution context
   * @returns True when the route is public or the session is valid
   * @throws {UnauthorizedException} `UNAUTHENTICATED` for protected routes without a valid session
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const http = context.switchToHttp();
    const req = http.getRequest<AuthenticatedRequest>();
    const token = this.sessions.readCookie(req);

    if (token) {
      const session = await this.sessions.validate(token);
      if (session) {
        req.auth = { user: session.user, sessionId: session.sessionId };
        if (session.renewedExpiresAt) {
          this.sessions.setCookie(http.getResponse<Response>(), token, session.renewedExpiresAt);
        }
      }
    }

    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic || req.auth) return true;

    throw new UnauthorizedException({
      code: ErrorCode.UNAUTHENTICATED,
      message: 'Please log in to continue.',
    });
  }
}
