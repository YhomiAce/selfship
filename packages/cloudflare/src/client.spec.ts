import { CloudflareApiError, CloudflareDnsClient } from './client';

type Route = (body: unknown) => { status?: number; json: unknown };

/** Fake Cloudflare API routed by "METHOD /path"; records calls (and the auth header). */
function fake(routes: Record<string, Route>): {
  client: CloudflareDnsClient;
  calls: string[];
  auth: string[];
} {
  const calls: string[] = [];
  const auth: string[] = [];
  const fetchImpl = ((input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const key = `${init.method ?? 'GET'} ${url.pathname.replace('/client/v4/zones/zone-1', '')}`;
    calls.push(`${key}${url.search}`);
    auth.push(new Headers(init.headers).get('authorization') ?? '');
    const route = routes[key];
    const out = route
      ? route(typeof init.body === 'string' ? JSON.parse(init.body) : undefined)
      : { status: 404, json: { success: false, errors: [{ message: 'not found' }], result: null } };
    return Promise.resolve(new Response(JSON.stringify(out.json), { status: out.status ?? 200 }));
  }) as typeof fetch;
  return {
    client: new CloudflareDnsClient({ apiToken: 'cf-secret', zoneId: 'zone-1', fetch: fetchImpl }),
    calls,
    auth,
  };
}

const ok = (result: unknown): { json: unknown } => ({
  json: { success: true, errors: [], result },
});

describe('CloudflareDnsClient', () => {
  it('creates a DNS-only A record when none exists', async () => {
    let sent: unknown;
    const { client, calls, auth } = fake({
      'GET /dns_records': () => ok([]),
      'POST /dns_records': (body) => {
        sent = body;
        return ok({ id: 'r1', name: 'shop.selfship.app', content: '1.2.3.4' });
      },
    });
    await expect(client.upsertA('shop.selfship.app', '1.2.3.4', 'project p1')).resolves.toEqual({
      id: 'r1',
      name: 'shop.selfship.app',
      content: '1.2.3.4',
    });
    expect(sent).toEqual({
      type: 'A',
      name: 'shop.selfship.app',
      content: '1.2.3.4',
      ttl: 60,
      proxied: false,
      comment: 'project p1',
    });
    expect(calls[0]).toBe('GET /dns_records?type=A&name=shop.selfship.app&per_page=5');
    expect(auth.every((a) => a === 'Bearer cf-secret')).toBe(true);
  });

  it('updates the existing record instead of creating a duplicate', async () => {
    const { client, calls } = fake({
      'GET /dns_records': () => ok([{ id: 'r1', name: 'shop.selfship.app', content: '1.1.1.1' }]),
      'PUT /dns_records/r1': () => ok({ id: 'r1', name: 'shop.selfship.app', content: '5.6.7.8' }),
    });
    await client.upsertA('shop.selfship.app', '5.6.7.8', 'x');
    expect(calls).toEqual([
      'GET /dns_records?type=A&name=shop.selfship.app&per_page=5',
      'PUT /dns_records/r1',
    ]);
  });

  it('treats deleting a missing record as done', async () => {
    const { client } = fake({});
    await expect(client.delete('gone')).resolves.toBeUndefined();
  });

  it("reports Cloudflare's error messages without the token", async () => {
    const { client } = fake({
      'GET /dns_records': () => ({
        status: 403,
        json: {
          success: false,
          errors: [{ code: 10000, message: 'Authentication error' }],
          result: null,
        },
      }),
    });
    const error = await client.findA('x.selfship.app').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloudflareApiError);
    expect((error as CloudflareApiError).status).toBe(403);
    expect((error as Error).message).toContain('Authentication error');
    expect((error as Error).message).not.toContain('cf-secret');
  });
});
