import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ErrorCode } from '@selfship/shared';
import { AppConfigService } from '../../config/app-config.service';

/** Methods that don't change state and therefore don't need CSRF checks. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence in depth (on top of `SameSite=Lax` cookies).
 *
 * Browsers always send `Origin` on cross-site POST/PUT/DELETE. If it is
 * present it must match the web app's origin. Requests without `Origin`
 * (curl, server-to-server, webhooks) carry no ambient browser cookies, so
 * they're allowed and authenticate by other means.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  /**
   * @param context - Nest execution context
   * @returns True if the request is safe or comes from an allowed origin
   * @throws {ForbiddenException} For state-changing requests from a foreign origin
   */
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const req = context.switchToHttp().getRequest<Request>();
    const origin = req.get('origin');
    if (SAFE_METHODS.has(req.method) || !origin) return true;

    if (origin === new URL(this.config.get('WEB_URL')).origin) return true;

    throw new ForbiddenException({
      code: ErrorCode.FORBIDDEN,
      message: 'Request blocked: unexpected origin.',
    });
  }
}
