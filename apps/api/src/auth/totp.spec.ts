import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  otpauthUri,
  totpCode,
  verifyTotp,
} from './totp';

// RFC 6238 Appendix B test vectors (SHA-1, 8 digits). Secret: ASCII "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('matches RFC 6238 at T=%i', (seconds, expected) => {
    expect(totpCode(RFC_SECRET, Math.floor(seconds / 30), 8)).toBe(expected);
  });

  it('round-trips base32', () => {
    const bytes = Buffer.from('any bytes \u0000ÿ here');
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    expect(base32Decode('mzxw 6ytb oi======')).toEqual(Buffer.from('foobar'));
  });

  it('accepts the current code and one step of drift, then refuses reuse', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    const now = 1_800_000_000_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(secret, totpCode(secret, step), null, now)).toBe(step);
    expect(verifyTotp(secret, totpCode(secret, step - 1), null, now)).toBe(step - 1);
    expect(verifyTotp(secret, totpCode(secret, step - 2), null, now)).toBeNull();
    // Already used: the same (or an older) step is refused.
    expect(verifyTotp(secret, totpCode(secret, step), step, now)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', null, now)).toBeNull();
  });

  it('builds the URI authenticator apps import', () => {
    expect(otpauthUri('Selfship', 'ada@example.com', 'ABC')).toBe(
      'otpauth://totp/Selfship:ada%40example.com?secret=ABC&issuer=Selfship&algorithm=SHA1&digits=6&period=30',
    );
  });
});
