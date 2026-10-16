import { utils } from 'ssh2';
import { generateKeyPair, inspectPrivateKey, InvalidPrivateKeyError } from './keys';

describe('generateKeyPair', () => {
  it('creates an Ed25519 key whose public line carries the comment', () => {
    const pair = generateKeyPair('selfship-abc123');
    expect(pair.privateKey).toContain('BEGIN OPENSSH PRIVATE KEY');
    expect(pair.publicKey).toMatch(/^ssh-ed25519 [A-Za-z0-9+/=]+ selfship-abc123$/);
  });
});

describe('inspectPrivateKey', () => {
  it('derives the same public key as the generator', () => {
    const pair = generateKeyPair('c');
    expect(inspectPrivateKey(pair.privateKey, 'c').publicKey).toBe(pair.publicKey);
  });

  it('normalises Windows line endings and surrounding whitespace', () => {
    const pair = generateKeyPair('c');
    const messy = `\n  ${pair.privateKey.replace(/\n/g, '\r\n')}  \n`;
    expect(inspectPrivateKey(messy, 'c').publicKey).toBe(pair.publicKey);
  });

  it('rejects passphrase-protected keys with instructions', () => {
    const encrypted = utils.generateKeyPairSync('ed25519', {
      passphrase: 'secret',
      cipher: 'aes256-ctr',
      rounds: 16,
    });
    expect(() => inspectPrivateKey(encrypted.private, 'c')).toThrow(/passphrase/);
  });

  it('rejects public keys and garbage', () => {
    const pair = generateKeyPair('c');
    expect(() => inspectPrivateKey(pair.publicKey, 'c')).toThrow(InvalidPrivateKeyError);
    expect(() => inspectPrivateKey('hello', 'c')).toThrow(/not a valid SSH private key/);
  });
});
