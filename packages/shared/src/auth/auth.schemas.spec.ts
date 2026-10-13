import { LoginSchema, RegisterSchema, ResetPasswordSchema } from './auth.schemas';

describe('RegisterSchema', () => {
  const valid = { name: '  Ada Lovelace ', email: ' Ada@Example.COM ', password: 'correct horse' };

  it('normalises name and email', () => {
    expect(RegisterSchema.parse(valid)).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'correct horse',
    });
  });

  it('rejects short passwords with a friendly message', () => {
    const result = RegisterSchema.safeParse({ ...valid, password: 'short' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Use at least 10 characters.');
  });

  it('rejects invalid emails', () => {
    const result = RegisterSchema.safeParse({ ...valid, email: 'not-an-email' });
    expect(result.error?.issues[0]?.path).toEqual(['email']);
  });

  it('rejects empty names', () => {
    expect(RegisterSchema.safeParse({ ...valid, name: '   ' }).success).toBe(false);
  });
});

describe('LoginSchema', () => {
  it('does not apply new-password rules at login', () => {
    expect(LoginSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
  });
});

describe('ResetPasswordSchema', () => {
  it('rejects obviously invalid tokens', () => {
    expect(ResetPasswordSchema.safeParse({ token: 'abc', password: 'long enough!' }).success).toBe(
      false,
    );
  });
});
