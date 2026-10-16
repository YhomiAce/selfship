import { validateEnv } from './env.schema';

describe('validateEnv', () => {
  const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db', ENCRYPTION_KEY: 'test' };

  it('applies defaults', () => {
    const env = validateEnv(base);
    expect(env.API_PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.REDIS_URL).toBe('redis://localhost:6380');
  });

  it('coerces numeric strings', () => {
    expect(validateEnv({ ...base, API_PORT: '5000' }).API_PORT).toBe(5000);
  });

  it('lists every invalid variable', () => {
    expect(() => validateEnv({ API_PORT: 'abc' })).toThrow(
      /DATABASE_URL[\s\S]*API_PORT|API_PORT[\s\S]*DATABASE_URL/,
    );
  });
});

describe('validateEnv: GitHub App settings', () => {
  const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db', ENCRYPTION_KEY: 'test' };
  const app = {
    GITHUB_APP_ID: '1',
    GITHUB_APP_SLUG: 'selfship',
    GITHUB_APP_CLIENT_ID: 'Iv1.x',
    GITHUB_APP_CLIENT_SECRET: 's',
    GITHUB_APP_PRIVATE_KEY: '-----BEGIN RSA PRIVATE KEY-----',
    GITHUB_WEBHOOK_SECRET: 'w',
  };

  it('treats empty values as not set', () => {
    const env = validateEnv({
      ...base,
      GITHUB_APP_ID: '',
      GITHUB_CLIENT_ID: '',
      GITHUB_CLIENT_SECRET: '',
    });
    expect(env.GITHUB_APP_ID).toBeUndefined();
    expect(env.GITHUB_CLIENT_ID).toBeUndefined();
  });

  it('accepts a complete GitHub App configuration', () => {
    expect(validateEnv({ ...base, ...app }).GITHUB_APP_SLUG).toBe('selfship');
  });

  it('rejects a partial GitHub App configuration and names the missing keys', () => {
    expect(() => validateEnv({ ...base, GITHUB_APP_ID: '1' })).toThrow(/GITHUB_APP_PRIVATE_KEY/);
  });
});
