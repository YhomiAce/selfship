import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { User } from '@platform/db';
import type { AuthContext, AuthenticatedRequest } from '../auth.types';

/**
 * Injects the signed-in user into a route handler parameter.
 * Only use on routes protected by the auth guard (i.e. not `@Public()`).
 */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): User => {
  return authOf(ctx).user;
});

/** Injects the current session ID into a route handler parameter. */
export const CurrentSessionId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => {
    return authOf(ctx).sessionId;
  },
);

/** Reads the auth context set by the guard, failing loudly if it's missing. */
function authOf(ctx: ExecutionContext): AuthContext {
  const auth = ctx.switchToHttp().getRequest<AuthenticatedRequest>().auth;
  if (!auth) throw new Error('CurrentUser used on a route without authentication');
  return auth;
}
