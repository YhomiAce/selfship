import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('verifies a correct password', async () => {
    const hash = await service.hash('correct horse battery');
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(service.verify(hash, 'correct horse battery')).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await service.hash('correct horse battery');
    await expect(service.verify(hash, 'wrong')).resolves.toBe(false);
  });

  it('returns false (not an error) for a missing hash', async () => {
    await expect(service.verify(null, 'anything')).resolves.toBe(false);
  });

  it('returns false for a malformed hash', async () => {
    await expect(service.verify('not-a-hash', 'anything')).resolves.toBe(false);
  });

  it('flags hashes created with weaker parameters for rehash', async () => {
    const hash = await service.hash('pw');
    expect(service.needsRehash(hash)).toBe(false);
    expect(service.needsRehash('$argon2id$v=19$m=4096,t=1,p=1$c29tZXNhbHQ$aGFzaA')).toBe(true);
  });
});
