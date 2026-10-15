import { createPrivateKey, type KeyObject, sign } from 'node:crypto';

/**
 * Parses the GitHub App private key. Accepts a PEM string with real or
 * escaped (`\n`) newlines, as env files often store it on one line.
 *
 * @param pem - Private key in PEM format
 * @returns A Node key object
 * @throws {Error} If the key can't be parsed
 */
export function parsePrivateKey(pem: string): KeyObject {
  return createPrivateKey(pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem);
}

/** base64url-encodes a JSON value. */
function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/**
 * Creates the short-lived JWT a GitHub App uses to authenticate as itself
 * (needed to create installation tokens).
 *
 * Backdated by 60 seconds to tolerate clock drift, valid for 9 minutes
 * (GitHub's maximum is 10).
 *
 * @param appId - GitHub App ID (or client ID)
 * @param key - The app's private key
 * @param now - Current time in ms (injectable for tests)
 * @returns Signed RS256 JWT
 */
export function createAppJwt(appId: string, key: KeyObject, now: number = Date.now()): string {
  const issuedAt = Math.floor(now / 1000) - 60;
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iat: issuedAt,
    exp: issuedAt + 600 - 60,
    iss: appId,
  })}`;
  const signature = sign('RSA-SHA256', Buffer.from(unsigned), key).toString('base64url');
  return `${unsigned}.${signature}`;
}
