import { checkDomainDns, type DnsLookups } from './dns-check';

const SERVER = '13.50.208.142';

/** Fake DNS answering from fixed tables; missing names fail like ENOTFOUND. */
function dns(a: Record<string, string[]>, aaaa: Record<string, string[]> = {}): DnsLookups {
  const lookup = (table: Record<string, string[]>) => (name: string) =>
    table[name] ? Promise.resolve(table[name]) : Promise.reject(new Error('ENOTFOUND'));
  return { resolve4: lookup(a), resolve6: lookup(aaaa) };
}

describe('checkDomainDns', () => {
  it('accepts a domain that points only at the server', async () => {
    await expect(
      checkDomainDns('app.example.com', SERVER, dns({ 'app.example.com': [SERVER] })),
    ).resolves.toEqual({
      ok: true,
      ipv4: [SERVER],
      ipv6: [],
      message: null,
    });
  });

  it('explains a missing record', async () => {
    const result = await checkDomainDns('app.example.com', SERVER, dns({}));
    expect(result.ok).toBe(false);
    expect(result.message).toContain(`Create an A record pointing to ${SERVER}`);
  });

  it('explains a record pointing elsewhere', async () => {
    const result = await checkDomainDns(
      'app.example.com',
      SERVER,
      dns({ 'app.example.com': ['93.184.216.34'] }),
    );
    expect(result.message).toContain('points to 93.184.216.34, not your server');
  });

  it("recognises Cloudflare's orange cloud", async () => {
    const result = await checkDomainDns(
      'app.example.com',
      SERVER,
      dns({ 'app.example.com': ['104.21.3.4', '172.67.1.2'] }),
    );
    expect(result.message).toContain('"DNS only" (grey cloud)');
  });

  it('flags extra A records and stray AAAA records', async () => {
    const extra = await checkDomainDns(
      'app.example.com',
      SERVER,
      dns({ 'app.example.com': [SERVER, '1.2.3.4'] }),
    );
    expect(extra.message).toContain('also points to 1.2.3.4');
    const ipv6 = await checkDomainDns(
      'app.example.com',
      SERVER,
      dns({ 'app.example.com': [SERVER] }, { 'app.example.com': ['2606:4700::1'] }),
    );
    expect(ipv6.ok).toBe(false);
    expect(ipv6.message).toContain('IPv6 (AAAA) record');
  });
});
