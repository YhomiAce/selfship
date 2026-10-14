import type { Request } from 'express';

/**
 * Reads a cookie as a plain string.
 *
 * `req.cookies` is untrusted: it is undefined without cookie-parser, and
 * cookie-parser turns values starting with `j:` into parsed JSON objects.
 * Anything that isn't a non-empty string is treated as absent.
 *
 * @param req - Express request
 * @param name - Cookie name
 * @returns The cookie value, or undefined
 */
export function readCookie(req: Request, name: string): string | undefined {
  const cookies: unknown = req.cookies;
  if (typeof cookies !== 'object' || cookies === null) return undefined;
  const value: unknown = (cookies as Record<string, unknown>)[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Narrows a query parameter to a single string.
 *
 * Express query values can be arrays (`?a=1&a=2`) or objects (`?a[b]=1`),
 * whatever the handler's type annotation claims.
 *
 * @param value - Raw query value
 * @returns The string value, or undefined for missing/array/object values
 */
export function queryString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
