import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Generates a URL-safe random token (256 bits of entropy).
 *
 * Used for session cookies, email links and OAuth state.
 *
 * @returns A base64url-encoded random string
 */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Hashes a token for storage. We never store raw tokens, so a database leak
 * does not let anyone hijack sessions or use email links.
 *
 * @param token - Raw token
 * @returns Hex-encoded SHA-256 hash
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Compares two strings in constant time to avoid timing attacks.
 *
 * @param a - First value
 * @param b - Second value
 * @returns True if both strings are identical
 */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
