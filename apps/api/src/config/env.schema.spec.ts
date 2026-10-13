import { validateEnv } from './env.schema';

describe('validateEnv', () => {
  const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };

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
