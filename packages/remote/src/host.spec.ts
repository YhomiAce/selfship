import { assertPublicHost, ForbiddenHostError, isBlockedAddress } from './host';

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.5.4',
    '192.168.1.10',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:10.0.0.1',
    'not-an-ip',
  ])('blocks %p', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(['13.50.208.142', '8.8.8.8', '2606:4700:4700::1111', '::ffff:13.50.208.142'])(
    'allows %p',
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    },
  );
});

describe('assertPublicHost', () => {
  it('accepts a public IP', async () => {
    await expect(assertPublicHost('13.50.208.142')).resolves.toEqual(['13.50.208.142']);
  });

  it.each(['10.0.0.5', 'localhost', '169.254.169.254'])('refuses %p', async (host) => {
    await expect(assertPublicHost(host)).rejects.toBeInstanceOf(ForbiddenHostError);
  });

  it.each(['http://x.com', 'host:22', 'a b', 'x'.repeat(300), 'bad_host!'])(
    'rejects malformed %p',
    async (host) => {
      await expect(assertPublicHost(host)).rejects.toThrow(/IP address or a hostname/);
    },
  );

  it('allows private addresses only when explicitly enabled (local development)', async () => {
    await expect(assertPublicHost('127.0.0.1', { allowPrivate: true })).resolves.toEqual([
      '127.0.0.1',
    ]);
  });
});
