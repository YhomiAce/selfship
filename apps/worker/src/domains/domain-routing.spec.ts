import { buildRouting } from './domain-routing.service';

const PREVIEW = 'shop-1a2b3c.13-50-208-142.sslip.io';
const platform = { hostname: 'shop.selfship.app', status: 'issuing' as const };

describe('buildRouting', () => {
  it('serves the free subdomain and the temporary host, preferring the subdomain', () => {
    expect(buildRouting([], platform, PREVIEW)).toEqual({
      routing: { hosts: ['shop.selfship.app', PREVIEW], redirects: [] },
      url: 'https://shop.selfship.app',
    });
  });

  it('falls back to the temporary host without a working subdomain', () => {
    expect(buildRouting([], null, PREVIEW).url).toBe(`https://${PREVIEW}`);
    expect(buildRouting([], { ...platform, status: 'error' }, PREVIEW).url).toBe(
      `https://${PREVIEW}`,
    );
  });

  it('routes verified custom domains, redirects www, and prefers an active custom domain', () => {
    const apex = {
      hostname: 'example.com',
      status: 'active' as const,
      redirectToId: null,
      redirectTo: null,
    };
    const www = {
      hostname: 'www.example.com',
      status: 'issuing' as const,
      redirectToId: 'apex-id',
      redirectTo: { hostname: 'example.com', status: 'active' as const },
    };
    const unverified = {
      hostname: 'new.example.com',
      status: 'pending_dns' as const,
      redirectToId: null,
      redirectTo: null,
    };
    expect(buildRouting([apex, www, unverified], platform, PREVIEW)).toEqual({
      routing: {
        hosts: ['example.com', 'shop.selfship.app', PREVIEW],
        redirects: [{ from: 'www.example.com', to: 'example.com' }],
      },
      url: 'https://example.com',
    });
  });

  it('keeps the subdomain as the main URL while the custom domain waits for its certificate', () => {
    const apex = {
      hostname: 'example.com',
      status: 'issuing' as const,
      redirectToId: null,
      redirectTo: null,
    };
    const result = buildRouting([apex], platform, PREVIEW);
    expect(result.routing.hosts).toContain('example.com');
    expect(result.url).toBe('https://shop.selfship.app');
  });
});
