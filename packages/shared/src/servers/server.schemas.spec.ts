import { CreateServerSchema, ServerHostSchema, SshUserSchema } from './server.schemas';

describe('CreateServerSchema', () => {
  const base = { name: 'Prod VPS', host: '13.50.208.142', port: 22, sshUser: 'root' };

  it('accepts each access method with its required field', () => {
    expect(CreateServerSchema.safeParse({ ...base, method: 'generated' }).success).toBe(true);
    expect(
      CreateServerSchema.safeParse({ ...base, method: 'password', password: 'x' }).success,
    ).toBe(true);
    expect(
      CreateServerSchema.safeParse({
        ...base,
        method: 'pasted',
        privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\n…',
      }).success,
    ).toBe(true);
  });

  it('requires the method-specific field', () => {
    expect(CreateServerSchema.safeParse({ ...base, method: 'password' }).success).toBe(false);
    expect(
      CreateServerSchema.safeParse({ ...base, method: 'pasted', privateKey: 'ssh-ed25519 AAAA' })
        .success,
    ).toBe(false);
  });

  it('rejects unknown methods', () => {
    expect(CreateServerSchema.safeParse({ ...base, method: 'telnet' }).success).toBe(false);
  });
});

describe('ServerHostSchema', () => {
  it.each(['13.50.208.142', 'vps.example.com', '2001:db8::1'])('accepts %p', (host) => {
    expect(ServerHostSchema.safeParse(host).success).toBe(true);
  });

  it.each(['http://x.com', 'x.com:22', 'a b', ''])('rejects %p', (host) => {
    expect(ServerHostSchema.safeParse(host).success).toBe(false);
  });
});

describe('SshUserSchema', () => {
  it.each(['root', 'ubuntu', 'deploy_user', 'ci-bot'])('accepts %p', (user) => {
    expect(SshUserSchema.safeParse(user).success).toBe(true);
  });

  it.each(['Root', 'a b', 'x;rm', '1abc'])('rejects %p', (user) => {
    expect(SshUserSchema.safeParse(user).success).toBe(false);
  });
});
