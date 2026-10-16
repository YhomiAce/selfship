import { execFileSync } from 'node:child_process';
import { fingerprint, sh } from './ssh';

describe('sh (shell quoting)', () => {
  it.each([
    'plain',
    "it's",
    '$(rm -rf /)',
    '`whoami`',
    'a; b && c | d',
    '"double" and \'single\'',
    'new\nline',
    '*?[glob]',
    '',
  ])('passes %p through bash unchanged', (value) => {
    const out = execFileSync('bash', ['-c', `printf %s ${sh(value)}`]).toString();
    expect(out).toBe(value);
  });
});

describe('fingerprint', () => {
  it('matches the OpenSSH format', () => {
    expect(fingerprint(Buffer.from('abc'))).toBe(
      'SHA256:ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0',
    );
  });
});
