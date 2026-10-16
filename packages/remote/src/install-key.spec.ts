import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BOOTSTRAP_SCRIPT } from './bootstrap';
import { authorizeKeyCommand, revokeKeyCommand } from './install-key';
import { generateKeyPair } from './keys';

describe('authorize / revoke commands (run for real against a temp HOME)', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'selfship-keys-'));
  const run = (command: string): void => {
    execFileSync('bash', ['-c', command], { env: { ...process.env, HOME: home } });
  };
  const ours = generateKeyPair('selfship-test01').publicKey;
  const theirs = generateKeyPair('alice@laptop').publicKey;

  it('adds our key without touching existing keys', () => {
    execFileSync('bash', ['-c', 'mkdir -p ~/.ssh'], { env: { ...process.env, HOME: home } });
    writeFileSync(path.join(home, '.ssh', 'authorized_keys'), `${theirs}\n`);
    run(authorizeKeyCommand(ours));
    expect(
      readFileSync(path.join(home, '.ssh', 'authorized_keys'), 'utf8')
        .split('\n')
        .filter(Boolean),
    ).toEqual([theirs, ours]);
  });

  it('revokes only our key', () => {
    run(revokeKeyCommand('selfship-test01'));
    expect(readFileSync(path.join(home, '.ssh', 'authorized_keys'), 'utf8').trim()).toBe(theirs);
  });

  it('refuses unsafe comments', () => {
    expect(() => revokeKeyCommand('x/; rm -rf ~')).toThrow();
  });
});

describe('bootstrap script', () => {
  it('is valid bash', () => {
    expect(() => execFileSync('bash', ['-n'], { input: BOOTSTRAP_SCRIPT })).not.toThrow();
  });
});
