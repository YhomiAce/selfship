import { type NextRequest, NextResponse } from 'next/server';

/** Session cookie names set by the API (`__Host-` prefix in production). */
const SESSION_COOKIES = ['__Host-sid', 'sid'];

/**
 * Optimistic auth check: visitors without a session cookie are sent to the
 * login page before any dashboard code loads. The API still validates the
 * session on every request; this only saves a round trip and a flash.
 *
 * @param request - Incoming request
 * @returns A redirect to /login, or `next()` to continue
 */
export function proxy(request: NextRequest): NextResponse {
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (hasSession) return NextResponse.next();

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('next', request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/dashboard', '/dashboard/:path*'],
};
