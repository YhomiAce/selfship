import { DecryptionError } from '@selfship/crypto';
import { ForbiddenHostError, HostKeyMismatchError, RemoteCommandError } from '@selfship/remote';
import { classifyFailure } from './server-job.runner';

const server = { host: '13.50.208.142', port: 22, sshUser: 'ubuntu' };

/** Error with ssh2's `level` property. */
function sshError(message: string, level?: string): Error {
  return Object.assign(new Error(message), level ? { level } : {});
}

describe('classifyFailure', () => {
  it('explains a changed host key', () => {
    const result = classifyFailure(
      new HostKeyMismatchError('SHA256:a', 'SHA256:b'),
      server,
      'connect',
    );
    expect(result.status).toBe('unreachable');
    expect(result.message).toContain('identity changed');
    expect(result.message).toContain('remove it from Selfship and add it again');
  });

  it('tells the user to add our key when login fails', () => {
    const result = classifyFailure(
      sshError('All configured authentication methods failed', 'client-authentication'),
      server,
      'connect',
    );
    expect(result.status).toBe('unreachable');
    expect(result.message).toContain('public key is in ~ubuntu/.ssh/authorized_keys');
  });

  it.each([
    ['connect ECONNREFUSED 13.50.208.142:22', 'refused the connection'],
    ['connect ETIMEDOUT 13.50.208.142:22', "Couldn't reach"],
    ['Timed out while waiting for handshake', "Couldn't reach"],
  ])('explains network error %p', (message, expected) => {
    expect(classifyFailure(sshError(message), server, 'connect').message).toContain(expected);
  });

  it('marks failed bootstrap commands as setup_failed', () => {
    const result = classifyFailure(
      new RemoteCommandError('bash -s', 100, 'apt failed'),
      server,
      'setup',
    );
    expect(result.status).toBe('setup_failed');
    expect(result.message).toContain('exit code 100');
  });

  it('handles forbidden hosts and unreadable keys', () => {
    expect(
      classifyFailure(new ForbiddenHostError('private address'), server, 'connect').message,
    ).toBe('private address');
    expect(classifyFailure(new DecryptionError('x'), server, 'connect').message).toContain(
      'stored key',
    );
  });

  it('falls back to a trimmed message', () => {
    const result = classifyFailure(new Error('x'.repeat(1000)), server, 'setup');
    expect(result.status).toBe('setup_failed');
    expect(result.message.length).toBeLessThanOrEqual(300);
  });
});
