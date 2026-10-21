import { failureFingerprint } from './fingerprint';
import { REDACTED, redactSecrets } from './redact';

describe('redactSecrets', () => {
  it.each([
    ['token ghp_abcdefghijklmnopqrstuvwxyz0123', 'token [redacted]'],
    ['key AKIAABCDEFGHIJKLMNOP done', 'key [redacted] done'],
    ['ANTHROPIC sk-ant-api03-abcdefghijklmnopqrstu', 'ANTHROPIC [redacted]'],
    ['stripe sk_live_abcdefghij12345', 'stripe [redacted]'],
    ['jwt eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0NTY.SflKxwRJSMeKKF2QT4fw', 'jwt [redacted]'],
  ])('%s', (input, expected) => {
    expect(redactSecrets(input)).toBe(expected);
  });

  it('keeps connection strings readable but hides the password', () => {
    expect(redactSecrets('connect postgres://app:s3cretPass@db:5432/app failed')).toBe(
      `connect postgres://app:${REDACTED}@db:5432/app failed`,
    );
  });

  it('hides values assigned to secret-looking names', () => {
    expect(redactSecrets('DB_PASSWORD=hunter2hunter "api_key": "abcd1234efgh"')).toBe(
      `DB_PASSWORD=${REDACTED} "api_key": "${REDACTED}"`,
    );
  });

  it('removes whole private key blocks', () => {
    expect(
      redactSecrets(
        'a\n-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----\nb',
      ),
    ).toBe(`a\n${REDACTED}\nb`);
  });

  it('leaves ordinary build output alone', () => {
    const line = '#14 2.907 Error: Cannot find module ./Header (exit code 1)';
    expect(redactSecrets(line)).toBe(line);
  });
});

describe('failureFingerprint', () => {
  const base = { adapter: 'spa', stage: 'building', packageJson: '{"name":"web"}' };

  it('ignores volatile details', () => {
    const a = failureFingerprint({
      ...base,
      log: '#14 2.907 Error: error:0308010C unsupported\n#15 DONE 3.2s',
    });
    const b = failureFingerprint({
      ...base,
      log: '#22 9.001 Error: error:0308010C unsupported\n#30 DONE 8.1s',
    });
    expect(a).toBe(b);
  });

  it('differs for different errors or projects', () => {
    const a = failureFingerprint({ ...base, log: 'Error: Missing script "build"' });
    expect(failureFingerprint({ ...base, log: 'Error: Cannot find module x' })).not.toBe(a);
    expect(
      failureFingerprint({ ...base, adapter: 'node', log: 'Error: Missing script "build"' }),
    ).not.toBe(a);
  });
});
