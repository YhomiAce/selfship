import { isBuildTimeKey, parseDotenv } from './dotenv';
import { EnvKeySchema, UpsertEnvVarsSchema } from './env-var.schemas';

/** Parses and returns `{ KEY: value }` for compact assertions. */
function values(text: string): Record<string, string> {
  return Object.fromEntries(parseDotenv(text).entries.map((e) => [e.key, e.value]));
}

describe('parseDotenv', () => {
  it('reads a typical 10-line .env', () => {
    const text = [
      '# Database',
      'DATABASE_URL=postgres://u:p@db:5432/app',
      'export NODE_ENV=production',
      '',
      'API_KEY="sk_test_123"   # inline comment after quotes',
      "LITERAL='no $expansion \\n here'",
      'EMPTY=',
      'SPACED = value with spaces   ',
      'URL=https://example.com/#anchor',
      'WITH_COMMENT=abc # trailing',
    ].join('\n');
    const result = parseDotenv(text);
    expect(result.errors).toEqual([]);
    expect(values(text)).toEqual({
      DATABASE_URL: 'postgres://u:p@db:5432/app',
      NODE_ENV: 'production',
      API_KEY: 'sk_test_123',
      LITERAL: 'no $expansion \\n here',
      EMPTY: '',
      SPACED: 'value with spaces',
      URL: 'https://example.com/#anchor',
      WITH_COMMENT: 'abc',
    });
  });

  it('supports multiline quoted values and escapes', () => {
    const text = [
      'PRIVATE_KEY="-----BEGIN KEY-----',
      'abc',
      '-----END KEY-----"',
      'ESCAPED="line1\\nline2 \\"quoted\\" \\\\ done"',
      'NEXT=1',
    ].join('\n');
    expect(values(text)).toEqual({
      PRIVATE_KEY: '-----BEGIN KEY-----\nabc\n-----END KEY-----',
      ESCAPED: 'line1\nline2 "quoted" \\ done',
      NEXT: '1',
    });
  });

  it('handles Windows line endings', () => {
    expect(values('A=1\r\nB="x"\r\n')).toEqual({ A: '1', B: 'x' });
  });

  it('keeps the last definition of a duplicate key', () => {
    const { entries } = parseDotenv('A=1\nB=2\nA=3');
    expect(entries.map((e) => `${e.key}=${e.value}@${e.line}`)).toEqual(['B=2@2', 'A=3@3']);
  });

  it('reports bad lines with their line numbers and keeps going', () => {
    const { entries, errors } = parseDotenv(
      'GOOD=1\nnot a variable\n1BAD=x\nOPEN="never closed\nLATE=2',
    );
    expect(entries.map((e) => e.key)).toEqual(['GOOD']);
    expect(errors).toEqual([
      { line: 2, message: 'Expected KEY=value.' },
      { line: 3, message: expect.stringContaining('"1BAD" isn\'t a valid name') },
      { line: 4, message: 'Missing closing " for OPEN.' },
    ]);
  });

  it('rejects text after a closing quote', () => {
    expect(parseDotenv('A="x" y').errors[0]?.message).toContain('Unexpected text');
  });
});

describe('isBuildTimeKey', () => {
  it.each([
    ['NEXT_PUBLIC_API_URL', true],
    ['VITE_KEY', true],
    ['REACT_APP_X', true],
    ['DATABASE_URL', false],
    ['NEXT_SECRET', false],
  ])('%s → %s', (key, expected) => {
    expect(isBuildTimeKey(key)).toBe(expected);
  });
});

describe('env var schemas', () => {
  it('rejects reserved and invalid names', () => {
    expect(EnvKeySchema.safeParse('PORT').success).toBe(false);
    expect(EnvKeySchema.safeParse('MY-VAR').success).toBe(false);
    expect(EnvKeySchema.safeParse('MY_VAR').success).toBe(true);
  });

  it('rejects duplicate names in one request', () => {
    const result = UpsertEnvVarsSchema.safeParse({
      vars: [
        { key: 'A', value: '1', scope: 'runtime' },
        { key: 'A', value: '2', scope: 'build' },
      ],
    });
    expect(result.success).toBe(false);
  });
});
