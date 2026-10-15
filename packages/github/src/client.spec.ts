import { generateKeyPairSync, verify } from 'node:crypto';
import { GithubAppClient } from './client';
import { GithubApiError } from './errors';
import { createAppJwt, parsePrivateKey } from './jwt';
import { githubRepoSnapshot, RootDirectoryNotFoundError } from './snapshot';
import { verifyWebhookSignature } from './webhooks';
import { createHmac } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

/** Builds a fake fetch that routes by "METHOD /path" and records calls. */
function fakeGithub(routes: Record<string, Handler>): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const key = `${init.method ?? 'GET'} ${url.pathname}`;
    calls.push(`${key}${url.search}`);
    const handler = routes[key];
    return handler ? handler(url, init) : new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const tokenRoute =
  (expiresInMs = 3600_000): Handler =>
  () =>
    json({
      token: `tok-${Math.random()}`,
      expires_at: new Date(Date.now() + expiresInMs).toISOString(),
    });

/** Creates a client with the fake fetch. */
function makeClient(routes: Record<string, Handler>): { client: GithubAppClient; calls: string[] } {
  const fake = fakeGithub(routes);
  const client = new GithubAppClient({
    appId: '123',
    slug: 'selfship-test',
    clientId: 'cid',
    clientSecret: 'csecret',
    privateKey: PEM,
    fetch: fake.fetch,
  });
  return { client, calls: fake.calls };
}

const repo = (id: number): object => ({
  id,
  name: `repo-${id}`,
  full_name: `acme/repo-${id}`,
  owner: { login: 'acme' },
  private: true,
  default_branch: 'main',
  pushed_at: null,
});

describe('createAppJwt', () => {
  it('signs a verifiable RS256 token with the right claims', () => {
    const now = Date.UTC(2026, 9, 15, 12, 0, 0);
    const jwt = createAppJwt('123', parsePrivateKey(PEM), now);
    const [header = '', payload = '', signature = ''] = jwt.split('.');

    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    });
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<
      string,
      number | string
    >;
    expect(claims).toEqual({ iss: '123', iat: now / 1000 - 60, exp: now / 1000 - 60 + 540 });
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from(`${header}.${payload}`),
        publicKey,
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(true);
  });

  it('accepts keys stored with escaped newlines', () => {
    expect(() => parsePrivateKey(PEM.replace(/\n/g, '\\n'))).not.toThrow();
  });
});

describe('GithubAppClient', () => {
  it('caches installation tokens and shares concurrent requests', async () => {
    const { client, calls } = makeClient({
      'POST /app/installations/7/access_tokens': tokenRoute(),
      'GET /installation/repositories': () => json({ total_count: 1, repositories: [repo(1)] }),
    });

    await Promise.all([client.listRepositories(7), client.listRepositories(7)]);
    await client.listRepositories(7);

    expect(calls.filter((call) => call.includes('access_tokens'))).toHaveLength(1);
  });

  it('refreshes tokens that are about to expire', async () => {
    const { client, calls } = makeClient({
      'POST /app/installations/7/access_tokens': tokenRoute(60_000), // < 5 min margin
    });
    await client.getInstallationToken(7);
    await client.getInstallationToken(7);
    expect(calls.filter((call) => call.includes('access_tokens'))).toHaveLength(2);
  });

  it('paginates repositories', async () => {
    const { client, calls } = makeClient({
      'POST /app/installations/7/access_tokens': tokenRoute(),
      'GET /installation/repositories': (url) => {
        const page = Number(url.searchParams.get('page'));
        const ids = page === 1 ? Array.from({ length: 100 }, (_, i) => i + 1) : [101, 102];
        return json({ total_count: 102, repositories: ids.map(repo) });
      },
    });

    const repositories = await client.listRepositories(7);

    expect(repositories).toHaveLength(102);
    expect(repositories[0]).toEqual({
      id: 1,
      name: 'repo-1',
      fullName: 'acme/repo-1',
      owner: 'acme',
      private: true,
      defaultBranch: 'main',
      pushedAt: null,
    });
    expect(calls.filter((call) => call.startsWith('GET /installation/repositories'))).toHaveLength(
      2,
    );
  });

  it('retries once with a fresh token after a 401', async () => {
    let attempts = 0;
    const { client, calls } = makeClient({
      'POST /app/installations/7/access_tokens': tokenRoute(),
      'GET /repos/acme/web': () =>
        ++attempts === 1 ? new Response('', { status: 401 }) : json(repo(5)),
    });

    await expect(client.getRepository(7, 'acme/web')).resolves.toMatchObject({ id: 5 });
    expect(calls.filter((call) => call.includes('access_tokens'))).toHaveLength(2);
  });

  it('maps HTTP errors, bad bodies and timeouts to GithubApiError', async () => {
    const { client } = makeClient({
      'POST /app/installations/7/access_tokens': tokenRoute(),
      'GET /repos/acme/down': () => new Response('', { status: 503 }),
      'GET /repos/acme/weird': () => json({ unexpected: true }),
      'GET /repos/acme/slow': () => {
        const error = new Error('aborted');
        error.name = 'TimeoutError';
        throw error;
      },
    });

    await expect(client.getRepository(7, 'acme/down')).rejects.toMatchObject({ status: 503 });
    await expect(client.getRepository(7, 'acme/weird')).rejects.toMatchObject({ status: 502 });
    const timeout = await client.getRepository(7, 'acme/slow').catch((e: unknown) => e);
    expect(timeout).toBeInstanceOf(GithubApiError);
    expect((timeout as GithubApiError).status).toBe(0);
    expect((timeout as GithubApiError).message).toContain('timed out');
  });

  it('reads base64 files and skips large, missing or non-file paths', async () => {
    const { client } = makeClient({
      'POST /app/installations/7/access_tokens': tokenRoute(),
      'GET /repos/acme/web/contents/package.json': () =>
        json({
          type: 'file',
          encoding: 'base64',
          content: Buffer.from('{"a":1}').toString('base64'),
          size: 7,
        }),
      'GET /repos/acme/web/contents/big.json': () =>
        json({ type: 'file', encoding: 'base64', content: '', size: 10_000_000 }),
      'GET /repos/acme/web/contents/src': () =>
        json([{ name: 'a.ts', path: 'src/a.ts', type: 'file', size: 1 }]),
    });

    await expect(client.readFile(7, 'acme/web', 'package.json', 'main')).resolves.toBe('{"a":1}');
    await expect(client.readFile(7, 'acme/web', 'big.json', 'main')).resolves.toBeNull();
    await expect(client.readFile(7, 'acme/web', 'missing.txt', 'main')).resolves.toBeNull();
    await expect(client.readFile(7, 'acme/web', 'src', 'main')).resolves.toBeNull();
  });

  it('verifies installation ownership through the user code', async () => {
    const { client } = makeClient({
      'POST /login/oauth/access_token': () => json({ access_token: 'user-token' }),
      'GET /user/installations': (_url, init) => {
        const auth = (init.headers as Record<string, string>).Authorization;
        return auth === 'Bearer user-token'
          ? json({ total_count: 2, installations: [{ id: 7 }, { id: 9 }] })
          : new Response('', { status: 401 });
      },
    });
    await expect(client.installationIdsForUserCode('code')).resolves.toEqual([7, 9]);
  });

  it('rejects an invalid user code', async () => {
    const { client } = makeClient({
      'POST /login/oauth/access_token': () => json({ error: 'bad_verification_code' }),
    });
    await expect(client.installationIdsForUserCode('nope')).rejects.toBeInstanceOf(GithubApiError);
  });

  it('builds install and manage URLs', () => {
    const { client } = makeClient({});
    expect(client.installUrl('s t')).toBe(
      'https://github.com/apps/selfship-test/installations/new?state=s%20t',
    );
    expect(client.manageUrl(7, { login: 'acme', type: 'Organization' })).toBe(
      'https://github.com/organizations/acme/settings/installations/7',
    );
    expect(client.manageUrl(7, { login: 'ada', type: 'User' })).toBe(
      'https://github.com/settings/installations/7',
    );
  });
});

describe('githubRepoSnapshot', () => {
  const routes: Record<string, Handler> = {
    'POST /app/installations/7/access_tokens': tokenRoute(),
    'GET /repos/acme/mono/contents/apps/web': () =>
      json([
        { name: 'package.json', path: 'apps/web/package.json', type: 'file', size: 20 },
        { name: 'src', path: 'apps/web/src', type: 'dir', size: 0 },
      ]),
    'GET /repos/acme/mono/contents/apps/web/package.json': () =>
      json({
        type: 'file',
        encoding: 'base64',
        content: Buffer.from('{}').toString('base64'),
        size: 2,
      }),
  };

  it('lists the root directory and reads files relative to it (cached)', async () => {
    const { client, calls } = makeClient(routes);
    const snapshot = await githubRepoSnapshot(client, 7, 'acme/mono', 'main', 'apps/web');

    expect([...snapshot.files]).toEqual(['package.json', 'src']);
    await snapshot.readFile('package.json');
    await snapshot.readFile('package.json');
    await expect(snapshot.readFile('not-listed.json')).resolves.toBeNull();

    expect(calls.filter((call) => call.includes('/package.json'))).toHaveLength(1);
    expect(calls.some((call) => call.includes('not-listed'))).toBe(false);
  });

  it('throws when the root directory does not exist', async () => {
    const { client } = makeClient(routes);
    await expect(
      githubRepoSnapshot(client, 7, 'acme/mono', 'main', 'apps/api'),
    ).rejects.toBeInstanceOf(RootDirectoryNotFoundError);
  });
});

describe('verifyWebhookSignature', () => {
  const body = Buffer.from('{"action":"created"}');
  const signature = `sha256=${createHmac('sha256', 'secret').update(body).digest('hex')}`;

  it('accepts a valid signature', () => {
    expect(verifyWebhookSignature('secret', body, signature)).toBe(true);
  });

  it.each([
    ['wrong secret', 'other', signature],
    ['missing header', 'secret', undefined],
    ['wrong format', 'secret', 'sha1=abc'],
    ['truncated signature', 'secret', signature.slice(0, 20)],
  ])('rejects %s', (_label, secret, header) => {
    expect(verifyWebhookSignature(secret, body, header)).toBe(false);
  });

  it('rejects a tampered body', () => {
    expect(verifyWebhookSignature('secret', Buffer.from('{"action":"deleted"}'), signature)).toBe(
      false,
    );
  });
});

describe('path safety', () => {
  it('refuses repository names and paths that would change the URL path', async () => {
    const { client, calls } = makeClient({
      'POST /app/installations/7/access_tokens': tokenRoute(),
    });
    await expect(client.getRepository(7, '../etc')).rejects.toMatchObject({ status: 400 });
    await expect(client.readFile(7, 'acme/web', '../../secrets', 'main')).rejects.toMatchObject({
      status: 400,
    });
    expect(calls.some((call) => call.includes('..'))).toBe(false);
  });
});
