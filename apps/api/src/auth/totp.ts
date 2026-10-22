import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** RFC 4648 base32 alphabet (what authenticator apps expect). */
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
/** Codes change every 30 seconds (RFC 6238 default; every app uses it). */
export const TOTP_PERIOD_SECONDS = 30;
const DIGITS = 6;

/**
 * Encodes bytes as base32 without padding.
 *
 * @param bytes - Data
 * @returns Base32 string
 */
export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31] ?? '';
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31] ?? '';
  return output;
}

/**
 * Decodes base32 (case-insensitive, padding and spaces ignored).
 *
 * @param text - Base32 string
 * @returns Bytes
 * @throws {Error} On characters outside the alphabet
 */
export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error('Invalid base32 character');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/**
 * A new random secret (160 bits, as RFC 4226 recommends).
 *
 * @returns Base32 secret
 */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/**
 * The code for one time step (HOTP over the step counter, RFC 4226/6238).
 *
 * @param secret - Base32 secret
 * @param step - Time step (Unix seconds / 30)
 * @param digits - Code length (6 for apps; 8 in the RFC test vectors)
 * @returns Zero-padded code
 */
export function totpCode(secret: string, step: number, digits = DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const binary = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(binary).padStart(digits, '0');
}

/**
 * Checks a code, allowing one step of clock drift either way, and refusing
 * any step at or before the last one used (so a code works only once).
 *
 * @param secret - Base32 secret
 * @param code - 6-digit code
 * @param lastStep - Last accepted step (null if none)
 * @param now - Clock in milliseconds (tests)
 * @returns The matched step (store it as the new last step), or null
 */
export function verifyTotp(
  secret: string,
  code: string,
  lastStep: number | null,
  now = Date.now(),
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 1000 / TOTP_PERIOD_SECONDS);
  for (const step of [current - 1, current, current + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    const expected = Buffer.from(totpCode(secret, step));
    if (timingSafeEqual(expected, Buffer.from(code))) return step;
  }
  return null;
}

/**
 * The URI authenticator apps import (shown as a QR code).
 *
 * @param issuer - Shown as the account's provider, e.g. "Selfship"
 * @param account - Shown as the account name (the user's email)
 * @param secret - Base32 secret
 * @returns `otpauth://totp/...`
 */
export function otpauthUri(issuer: string, account: string, secret: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
