import { randomBytes } from 'node:crypto';
import { DecryptionError, EnvelopeCipher, parseMasterKeys } from './envelope';

const k1 = { id: 'k1', key: randomBytes(32) };
const k2 = { id: 'k2', key: randomBytes(32) };
const secret = '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----\n';

describe('EnvelopeCipher', () => {
  const cipher = new EnvelopeCipher(k1);

  it('round-trips a secret', () => {
    const stored = cipher.encrypt(secret, 'server:1:ssh-key');
    expect(stored.startsWith('v1.')).toBe(true);
    expect(stored).not.toContain('OPENSSH');
    expect(cipher.decrypt(stored, 'server:1:ssh-key')).toBe(secret);
  });

  it('produces a different ciphertext every time (random IVs and data keys)', () => {
    expect(cipher.encrypt(secret, 'c')).not.toBe(cipher.encrypt(secret, 'c'));
  });

  it('refuses to decrypt under another context (copied into another row)', () => {
    const stored = cipher.encrypt(secret, 'server:1:ssh-key');
    expect(() => cipher.decrypt(stored, 'server:2:ssh-key')).toThrow(DecryptionError);
  });

  it('detects tampering', () => {
    const stored = cipher.encrypt(secret, 'c');
    const json = JSON.parse(Buffer.from(stored.slice(3), 'base64url').toString()) as {
      d: string[];
    };
    const ct = Buffer.from(json.d[1] ?? '', 'base64url');
    ct[0] = (ct[0] ?? 0) ^ 0xff;
    json.d[1] = ct.toString('base64url');
    const tampered = `v1.${Buffer.from(JSON.stringify(json)).toString('base64url')}`;
    expect(() => cipher.decrypt(tampered, 'c')).toThrow(DecryptionError);
  });

  it.each(['', 'v2.abc', 'v1.', 'v1.!!!', `v1.${Buffer.from('{"v":"v1"}').toString('base64url')}`])(
    'rejects malformed input %p',
    (input) => {
      expect(() => cipher.decrypt(input, 'c')).toThrow(DecryptionError);
    },
  );

  it('rejects ciphertexts made with an unknown master key', () => {
    const other = new EnvelopeCipher({ id: 'kX', key: randomBytes(32) });
    expect(() => cipher.decrypt(other.encrypt(secret, 'c'), 'c')).toThrow(/Unknown master key/);
  });

  it('supports rotation: old ciphertexts decrypt and are flagged for re-encryption', () => {
    const old = new EnvelopeCipher(k1).encrypt(secret, 'c');
    const rotated = new EnvelopeCipher(k2, [k1]);
    expect(rotated.decrypt(old, 'c')).toBe(secret);
    expect(rotated.needsRotation(old)).toBe(true);
    expect(rotated.needsRotation(rotated.encrypt(secret, 'c'))).toBe(false);
  });

  it('validates keys', () => {
    expect(() => new EnvelopeCipher({ id: 'k1', key: randomBytes(16) })).toThrow(/32 bytes/);
    expect(() => new EnvelopeCipher(k1, [{ ...k1 }])).toThrow(/unique/);
  });
});

describe('parseMasterKeys', () => {
  it('parses active and previous keys', () => {
    const a = randomBytes(32).toString('base64');
    const b = randomBytes(32).toString('base64');
    const keys = parseMasterKeys('k2', a, `k1:${b}`);
    expect(keys.active.id).toBe('k2');
    expect(keys.previous.map((k) => k.id)).toEqual(['k1']);
  });

  it('explains how to generate a valid key', () => {
    expect(() => parseMasterKeys('k1', 'too-short')).toThrow(/openssl rand -base64 32/);
  });
});
