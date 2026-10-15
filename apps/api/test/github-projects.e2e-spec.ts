import { createHmac, randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { GITHUB_CLIENT } from '../src/github/github.constants';
import { MailService } from '../src/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { FakeGithubClient, fakeRepo } from './fake-github';

// A complete (dummy) GitHub App configuration; the real client is replaced by a fake.
const WEBHOOK_SECRET = 'test-webhook-secret';
Object.assign(process.env, {
  GITHUB_APP_ID: '1',
  GITHUB_APP_SLUG: 'selfship-test',
  GITHUB_APP_CLIENT_ID: 'Iv1.test',
  GITHUB_APP_CLIENT_SECRET: 'secret',
  GITHUB_APP_PRIVATE_KEY: 'unused-in-tests',
  GITHUB_WEBHOOK_SECRET: WEBHOOK_SECRET,
});

const runId = randomUUID().slice(0, 8);
// Unique numeric IDs per run so repeated runs don't collide in the shared dev database.
const base = Number.parseInt(runId.slice(0, 6), 16) * 10;
const ACME_INSTALL = base + 1;
const OTHER_INSTALL = base + 2;
const ACME_REINSTALL = base + 3;

/** Extracts the session cookie from a response. */
function sessionCookie(res: request.Response): string {
  const cookie = (res.get('Set-Cookie') ?? []).find((c) => c.startsWith('sid='));
  if (!cookie) throw new Error('no session cookie');
  return cookie.split(';')[0] ?? '';
}

describe('GitHub integration and projects (e2e)', () => {
  let app: NestExpressApplication;
  const github = new FakeGithubClient();
  let ada = '';
  let bob = '';
  let installationId = '';

  const http = (): ReturnType<typeof request> => request(app.getHttpServer());

  /** Sends a signed webhook. */
  const webhook = (event: string, payload: object, secret = WEBHOOK_SECRET): request.Test => {
    const body = JSON.stringify(payload);
    const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    return http()
      .post('/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-GitHub-Event', event)
      .set('X-Hub-Signature-256', signature)
      .send(body);
  };

  beforeAll(async () => {
    github.installations.set(ACME_INSTALL, {
      id: ACME_INSTALL,
      accountLogin: `acme-${runId}`,
      accountType: 'Organization',
      accountAvatarUrl: null,
      repositorySelection: 'selected',
      suspended: false,
    });
    github.repos.set(ACME_INSTALL, [
      fakeRepo(
        base + 11,
        'acme/next-site',
        {
          'package.json': JSON.stringify({
            scripts: { build: 'next build', start: 'next start' },
            dependencies: { next: '16' },
          }),
          'package-lock.json': '{}',
        },
        ['main', 'develop'],
      ),
      fakeRepo(base + 12, 'acme/vite-app', {
        'package.json': JSON.stringify({
          scripts: { build: 'vite build' },
          devDependencies: { vite: '7' },
        }),
      }),
      fakeRepo(base + 13, 'acme/plain-html', { 'index.html': '<h1>hi</h1>' }),
      fakeRepo(base + 14, 'acme/monorepo', {
        'apps/web/package.json': JSON.stringify({ scripts: { start: 'node server.js' } }),
        'README.md': '',
      }),
      fakeRepo(base + 15, 'acme/mystery', { 'main.py': 'print(1)' }),
    ]);
    github.codes.set('ada-code', [ACME_INSTALL]);
    github.codes.set('bob-code', [OTHER_INSTALL]);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GITHUB_CLIENT)
      .useValue(github)
      .overrideProvider(MailService)
      .useValue({ send: () => Promise.resolve() })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
    configureApp(app);
    await app.init();

    const register = async (name: string): Promise<string> => {
      const res = await http()
        .post('/auth/register')
        .send({ name, email: `${name}+${runId}@example.com`, password: 'correct horse battery' })
        .expect(201);
      return sessionCookie(res);
    };
    ada = await register('ada');
    bob = await register('bob');
  });

  afterAll(async () => {
    const prisma = app.get(PrismaService);
    await prisma.user.deleteMany({ where: { email: { contains: runId } } });
    await prisma.githubInstallation.deleteMany({
      where: {
        githubInstallationId: { in: [ACME_INSTALL, OTHER_INSTALL, ACME_REINSTALL].map(BigInt) },
      },
    });
    await app.close();
  });

  describe('connecting GitHub', () => {
    it('reports the integration as configured', async () => {
      await http().get('/github/status').set('Cookie', ada).expect(200, { configured: true });
    });

    it('redirects the install button to GitHub with a state cookie', async () => {
      const res = await http().get('/github/install').set('Cookie', ada).expect(302);
      expect(res.get('Location')).toMatch(/installations\/new\?state=/);
      expect(res.get('Set-Cookie')?.join(';')).toContain('gh_install_state=');
    });

    it('sends signed-out users from the setup callback to login', async () => {
      const res = await http()
        .get(`/github/setup?installation_id=${ACME_INSTALL}&code=ada-code`)
        .expect(302);
      expect(res.get('Location')).toContain('/login?next=');
    });

    it('refuses to link an installation the user cannot access on GitHub', async () => {
      const res = await http()
        .get(`/github/setup?installation_id=${ACME_INSTALL}&setup_action=install&code=bob-code`)
        .set('Cookie', bob)
        .expect(302);
      expect(res.get('Location')).toContain('github=error&reason=not_yours');
      const list = await http().get('/github/installations').set('Cookie', bob).expect(200);
      expect(list.body.items).toEqual([]);
    });

    it('rejects a state that does not match the cookie', async () => {
      const res = await http()
        .get(`/github/setup?installation_id=${ACME_INSTALL}&code=ada-code&state=forged`)
        .set('Cookie', `${ada}; gh_install_state=real`)
        .expect(302);
      expect(res.get('Location')).toContain('reason=state');
    });

    it('requires the OAuth code to prove ownership', async () => {
      const res = await http()
        .get(`/github/setup?installation_id=${ACME_INSTALL}`)
        .set('Cookie', ada)
        .expect(302);
      expect(res.get('Location')).toContain('reason=missing_code');
    });

    it('links the installation when GitHub confirms access', async () => {
      const res = await http()
        .get(`/github/setup?installation_id=${ACME_INSTALL}&setup_action=install&code=ada-code`)
        .set('Cookie', ada)
        .expect(302);
      expect(res.get('Location')).toContain('/dashboard/projects/new?github=connected');

      const list = await http().get('/github/installations').set('Cookie', ada).expect(200);
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0]).toMatchObject({
        accountLogin: `acme-${runId}`,
        accountType: 'Organization',
        suspended: false,
      });
      installationId = list.body.items[0].id;
    });

    it('starts the "link existing installations" flow with a state cookie', async () => {
      const res = await http().get('/github/link').set('Cookie', ada).expect(302);
      expect(res.get('Location')).toContain('/login/oauth/authorize?state=');
      expect(res.get('Location')).toContain(
        encodeURIComponent('http://localhost:3000/api/github/setup'),
      );
    });

    it('requires the state for the link flow', async () => {
      const res = await http().get('/github/setup?code=bob-code').set('Cookie', bob).expect(302);
      expect(res.get('Location')).toContain('reason=state');
    });

    it('continues to the install page when the app is not installed anywhere yet', async () => {
      github.codes.set('nobody-code', []);
      const res = await http()
        .get('/github/setup?code=nobody-code&state=s1')
        .set('Cookie', `${bob}; gh_install_state=s1`)
        .expect(302);
      expect(res.get('Location')).toMatch(/installations\/new\?state=/);
      expect(res.get('Set-Cookie')?.join(';')).toContain('gh_install_state=');
    });

    it('links every installation the user can access (no installation_id needed)', async () => {
      github.installations.set(OTHER_INSTALL, {
        id: OTHER_INSTALL,
        accountLogin: `bob-${runId}`,
        accountType: 'User',
        accountAvatarUrl: null,
        repositorySelection: 'all',
        suspended: false,
      });
      const res = await http()
        .get('/github/setup?code=bob-code&state=s2')
        .set('Cookie', `${bob}; gh_install_state=s2`)
        .expect(302);
      expect(res.get('Location')).toContain('github=connected');
      const list = await http().get('/github/installations').set('Cookie', bob).expect(200);
      expect(
        (list.body as { items: { accountLogin: string }[] }).items.map((i) => i.accountLogin),
      ).toEqual([`bob-${runId}`]);
    });

    it('handles "request" setups (awaiting org owner approval)', async () => {
      const res = await http()
        .get('/github/setup?setup_action=request')
        .set('Cookie', ada)
        .expect(302);
      expect(res.get('Location')).toContain('github=pending');
    });
  });

  describe('browsing repositories', () => {
    it('lists, searches and paginates repositories (cached)', async () => {
      const before = github.listRepositoriesCalls;
      const all = await http()
        .get(`/github/installations/${installationId}/repositories?pageSize=2`)
        .set('Cookie', ada)
        .expect(200);
      expect(all.body).toMatchObject({ total: 5, page: 1, pageSize: 2 });
      expect(all.body.items).toHaveLength(2);

      const search = await http()
        .get(`/github/installations/${installationId}/repositories?search=VITE`)
        .set('Cookie', ada)
        .expect(200);
      const items = (search.body as { items: { fullName: string }[] }).items;
      expect(items.map((r) => r.fullName)).toEqual(['acme/vite-app']);
      expect(github.listRepositoriesCalls - before).toBe(1); // second call served from Redis
    });

    it('lists branches with the default first', async () => {
      const res = await http()
        .get(`/github/installations/${installationId}/branches?repo=acme/next-site`)
        .set('Cookie', ada)
        .expect(200);
      expect(res.body).toEqual({ items: ['main', 'develop'], defaultBranch: 'main' });
    });

    it("hides other users' installations (404)", async () => {
      await http()
        .get(`/github/installations/${installationId}/repositories`)
        .set('Cookie', bob)
        .expect(404);
    });

    it('validates query parameters', async () => {
      await http()
        .get(`/github/installations/${installationId}/branches?repo=../etc`)
        .set('Cookie', ada)
        .expect(400);
      await http()
        .get('/github/installations/not-a-uuid/repositories')
        .set('Cookie', ada)
        .expect(400);
    });
  });

  describe('detection', () => {
    const detect = (repoFullName: string, rootDirectory = ''): request.Test =>
      http()
        .post('/projects/detect')
        .set('Cookie', ada)
        .send({ installationId, repoFullName, branch: 'main', rootDirectory });

    it.each([
      ['acme/next-site', 'nextjs'],
      ['acme/vite-app', 'spa'],
      ['acme/plain-html', 'static'],
    ])('detects %s as %s', async (repo, adapter) => {
      const res = await detect(repo).expect(200);
      expect(res.body.adapter).toBe(adapter);
    });

    it('detects inside a monorepo folder', async () => {
      const res = await detect('acme/monorepo', 'apps/web').expect(200);
      expect(res.body).toMatchObject({
        adapter: 'node',
        settings: { startCommand: 'npm run start' },
      });
    });

    it('returns editable fallback settings when nothing matches', async () => {
      const res = await detect('acme/mystery').expect(200);
      expect(res.body.adapter).toBeNull();
      expect(res.body.settings.adapter).toBe('node');
    });

    it('reports a missing root directory on the field', async () => {
      const res = await detect('acme/monorepo', 'apps/nope').expect(400);
      expect(res.body.code).toBe('ROOT_DIRECTORY_NOT_FOUND');
      expect(res.body.fieldErrors['source.rootDirectory']).toBeDefined();
    });

    it('returns 404 for repositories the app cannot access', async () => {
      const res = await detect('someone/else').expect(404);
      expect(res.body.code).toBe('REPO_NOT_ACCESSIBLE');
    });
  });

  describe('projects', () => {
    let projectId = '';
    const settings = {
      adapter: 'nextjs',
      installCommand: 'npm ci',
      buildCommand: 'npm run build',
      startCommand: 'npm run start',
      outputDirectory: null,
      port: 3000,
      nodeVersion: 22,
    };
    const create = (overrides: Record<string, unknown> = {}, cookie = ada): request.Test =>
      http()
        .post('/projects')
        .set('Cookie', cookie)
        .send({
          name: 'Next-Site',
          source: {
            installationId,
            repoFullName: 'acme/next-site',
            branch: 'main',
            rootDirectory: '',
          },
          settings,
          ...overrides,
        });

    it('creates a project (name normalised to a slug)', async () => {
      const res = await create().expect(201);
      expect(res.body).toMatchObject({
        name: 'next-site',
        repoFullName: 'acme/next-site',
        branch: 'main',
        settings: { adapter: 'nextjs', port: 3000 },
        github: { state: 'connected', accountLogin: `acme-${runId}` },
      });
      projectId = res.body.id;
    });

    it('rejects a duplicate name', async () => {
      const res = await create().expect(409);
      expect(res.body.fieldErrors.name).toBeDefined();
    });

    it('rejects a branch that does not exist', async () => {
      const res = await create({
        name: 'other',
        source: {
          installationId,
          repoFullName: 'acme/next-site',
          branch: 'nope',
          rootDirectory: '',
        },
      }).expect(400);
      expect(res.body.code).toBe('BRANCH_NOT_FOUND');
    });

    it('rejects invalid settings (multi-line command)', async () => {
      const res = await create({
        name: 'bad',
        settings: { ...settings, buildCommand: 'a\nRUN b' },
      }).expect(400);
      expect(res.body.fieldErrors['settings.buildCommand']).toBeDefined();
    });

    it("does not let users use someone else's installation", async () => {
      await create({ name: 'stolen' }, bob).expect(404);
    });

    it('lists and fetches only your own projects', async () => {
      const mine = await http().get('/projects').set('Cookie', ada).expect(200);
      const ids = (mine.body as { items: { id: string }[] }).items.map((p) => p.id);
      expect(ids).toContain(projectId);
      const theirs = await http().get('/projects').set('Cookie', bob).expect(200);
      expect(theirs.body.items).toEqual([]);
      await http().get(`/projects/${projectId}`).set('Cookie', bob).expect(404);
    });

    it('updates the branch after checking it exists', async () => {
      const res = await http()
        .patch(`/projects/${projectId}`)
        .set('Cookie', ada)
        .send({ branch: 'develop' })
        .expect(200);
      expect(res.body.branch).toBe('develop');
      await http()
        .patch(`/projects/${projectId}`)
        .set('Cookie', ada)
        .send({ branch: 'ghost' })
        .expect(400);
    });

    describe('webhooks', () => {
      it('rejects deliveries with a bad signature', async () => {
        await webhook('installation', { action: 'deleted' }, 'wrong-secret').expect(401);
      });

      it('answers ping and ignores unknown events', async () => {
        expect((await webhook('ping', { zen: 'hi' }).expect(202)).body.handled).toBe('ping');
        expect((await webhook('star', {}).expect(202)).body.handled).toBe('ignored');
      });

      it('acknowledges malformed payloads without failing', async () => {
        expect((await webhook('installation', { nope: true }).expect(202)).body.handled).toBe(
          'invalid_payload',
        );
      });

      it('marks projects as suspended when the app is suspended', async () => {
        await webhook('installation', {
          action: 'suspend',
          installation: {
            id: ACME_INSTALL,
            account: { login: `acme-${runId}`, type: 'Organization' },
            repository_selection: 'selected',
            suspended_at: new Date().toISOString(),
          },
        }).expect(202);

        const project = await http().get(`/projects/${projectId}`).set('Cookie', ada).expect(200);
        expect(project.body.github.state).toBe('suspended');
        const repos = await http()
          .get(`/github/installations/${installationId}/repositories`)
          .set('Cookie', ada)
          .expect(409);
        expect(repos.body.code).toBe('INSTALLATION_SUSPENDED');
      });

      it('marks projects as disconnected when the app is uninstalled', async () => {
        await webhook('installation', {
          action: 'deleted',
          installation: {
            id: ACME_INSTALL,
            account: { login: `acme-${runId}`, type: 'Organization' },
            repository_selection: 'selected',
          },
        }).expect(202);

        const project = await http().get(`/projects/${projectId}`).set('Cookie', ada).expect(200);
        expect(project.body.github.state).toBe('removed');
        const list = await http().get('/github/installations').set('Cookie', ada).expect(200);
        expect(list.body.items).toEqual([]);
      });
    });

    it('re-links projects when the account is reinstalled (new installation ID)', async () => {
      github.installations.set(ACME_REINSTALL, {
        ...(github.installations.get(ACME_INSTALL) ?? ({} as never)),
        id: ACME_REINSTALL,
      });
      github.repos.set(ACME_REINSTALL, github.repos.get(ACME_INSTALL) ?? []);
      github.codes.set('ada-code-2', [ACME_REINSTALL]);

      await http()
        .get(`/github/setup?installation_id=${ACME_REINSTALL}&setup_action=install&code=ada-code-2`)
        .set('Cookie', ada)
        .expect(302);

      const project = await http().get(`/projects/${projectId}`).set('Cookie', ada).expect(200);
      expect(project.body.github.state).toBe('connected');
      expect(project.body.github.installationId).not.toBe(installationId);
    });

    it('deletes a project', async () => {
      await http().delete(`/projects/${projectId}`).set('Cookie', bob).expect(404);
      await http().delete(`/projects/${projectId}`).set('Cookie', ada).expect(204);
      await http().get(`/projects/${projectId}`).set('Cookie', ada).expect(404);
    });
  });
});
