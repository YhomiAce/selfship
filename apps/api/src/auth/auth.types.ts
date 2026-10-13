import type { Request } from 'express';
import type { User } from '@platform/db';

/** Who made the request and from where; stored on sessions for auditing. */
export interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

/** The authenticated identity attached to a request by the auth guard. */
export interface AuthContext {
  user: User;
  sessionId: string;
}

/** Express request after the auth guard has run. */
export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
}

/**
 * Extracts the request context (IP and user agent) for session auditing.
 *
 * @param req - Express request (with `trust proxy` configured)
 * @returns IP address and truncated user agent
 */
export function requestContext(req: Request): RequestContext {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent')?.slice(0, 512) ?? null,
  };
}
