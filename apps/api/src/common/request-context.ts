import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

/** Who made the current request (for the audit log). */
export interface RequestInfo {
  ipAddress: string | null;
  userAgent: string | null;
}

const storage = new AsyncLocalStorage<RequestInfo>();

/**
 * Express middleware: remembers the client IP and user agent for the rest
 * of the request, so services can record them without passing `req` around.
 *
 * @param req - Request
 * @param _res - Response
 * @param next - Next middleware
 */
export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
  storage.run(
    {
      // "::ffff:203.0.113.5" is an IPv4 address in IPv6 notation: show it plainly.
      ipAddress: req.ip?.replace(/^::ffff:/, '') ?? null,
      userAgent: req.get('user-agent')?.slice(0, 512) ?? null,
    },
    next,
  );
}

/**
 * The current request's client details (nulls outside a request, e.g. jobs).
 *
 * @returns IP address and user agent
 */
export function currentRequestInfo(): RequestInfo {
  return storage.getStore() ?? { ipAddress: null, userAgent: null };
}
