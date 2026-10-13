/**
 * Validates a post-login redirect target to prevent open redirects.
 * Only same-site absolute paths are allowed (`/dashboard`, not `//evil.com`).
 *
 * @param next - Untrusted value from the `next` query parameter
 * @param fallback - Path used when `next` is missing or unsafe
 * @returns A safe in-app path
 */
export function safeRedirect(next: string | null, fallback = '/dashboard'): string {
  if (!next?.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  return next;
}
