import { createHmac, randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import request from 'supertest';
import {
  type DeploymentEvent,
  QueueName,
  redisConnectionFromUrl,
  DeploymentQueueJob,
} from '@selfship/shared';
import type { Deployment } from '@selfship/db';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { GITHUB_CLIENT } from '../src/github/github.constants';
import { MailService } from '../src/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { FakeGithubClient, fakeRepo } from './fake-github';

Object.assign(process.env, {
  GITHUB_APP_ID: '1',
  GITHUB_APP_SLUG: 'selfship-test',
  GITHUB_APP_CLIENT_ID: 'Iv1.test',
  GITHUB_APP_CLIENT_SECRET: 'secret',
  GITHUB_APP_PRIVATE_KEY: 'unused-in-tests',
  GITHUB_WEBHOOK_SECRET: 'test-webhook-secret',
});

const runId = randomUUID().slice(0, 8);
const INSTALL = Number.parseInt(runId.slice(0, 6), 16) * 10 + 7;
const REPO_ID = INSTALL * 10;

/** Extracts the session cookie from a response. */
function sessionCookie(res: request.Response): string {
  const cookie = (res.get('Set-Cookie') ?? []).find((c) => c.startsWith('sid='));
  if (!cookie) throw new Error('no session cookie');
  return cookie.split(';')[0] ?? '';
}

/** Reads a whole SSE response and returns its events. */
async function readEvents(test: request.Test): Promise<DeploymentEvent[]> {
  const res = await test
    .buffer(true)
    .parse((response, done) => {
      let text = '';
      response.on('data', (chunk: Buffer) => (text += chunk.toString()));
      response.on('end', () => {
        done(null, text);
      });
    })
    .expect(200);
  return String(res.body)
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)) as DeploymentEvent);
}

describe('Env vars and deployments (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let queue: Queue;
  const github = new FakeGithubClient();
  let ada = '';
  let bob = '';
  let adaId = '';
  let projectId = '';
  let serverId = '';
  let bobServerId = '';
  const http = (): ReturnType<typeof request> => request(app.getHttpServer());

  /** Inserts a server directly (these tests never connect to it). */
  const addServer = async (
    userId: string,
    name: string,
    status: 'ready' | 'checked',
  ): Promise<string> =>
    (
      await prisma.server.create({
        data: {
          id: randomUUID(),
          userId,
          name,
          host: '13.50.208.142',
          sshUser: 'root',
          keySource: 'generated',
          encryptedPrivateKey: 'unused',
          publicKey: 'unused',
          keyComment: 'selfship-test',
          status,
        },
      })
    ).id;

  beforeAll(async () => {
    github.installations.set(INSTALL, {
      id: INSTALL,
      accountLogin: `acme-${runId}`,
      accountType: 'Organization',
      accountAvatarUrl: null,
      repositorySelection: 'selected',
      suspended: false,
    });
    github.repos.set(INSTALL, [
      fakeRepo(REPO_ID, 'acme/web', { 'package.json': '{}', 'index.js': '' }),
    ]);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GITHUB_CLIENT)
      .useValue(github)
      .overrideProvider(MailService)
      .useValue({ send: () => Promise.resolve() })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    queue = new Queue(QueueName.DEPLOYMENTS, {
      connection: redisConnectionFromUrl(process.env.REDIS_URL ?? 'redis://localhost:6380'),
      prefix: process.env.QUEUE_PREFIX ?? 'bull',
    });

    const register = async (name: string): Promise<request.Response> =>
      http()
        .post('/auth/register')
        .send({
          name,
          email: `${name}+dep-${runId}@example.com`,
          password: 'correct horse battery',
        })
        .expect(201);
    const adaRes = await register('ada');
    ada = sessionCookie(adaRes);
    adaId = (adaRes.body as { user: { id: string } }).user.id;
    const bobRes = await register('bob');
    bob = sessionCookie(bobRes);

    // Link the installation to Ada directly (the connect flow is covered elsewhere).
    const installation = await prisma.githubInstallation.create({
      data: {
        githubInstallationId: BigInt(INSTALL),
        accountLogin: `acme-${runId}`,
        accountType: 'Organization',
        members: { create: { userId: adaId } },
      },
    });
    const project = await http()
      .post('/projects')
      .set('Cookie', ada)
      .send({
        name: `web-${runId}`,
        source: {
          installationId: installation.id,
          repoFullName: 'acme/web',
          branch: 'main',
          rootDirectory: '',
        },
        settings: {
          adapter: 'node',
          installCommand: 'npm ci',
          buildCommand: null,
          startCommand: 'npm start',
          outputDirectory: null,
          port: 3000,
          nodeVersion: 22,
        },
      })
      .expect(201);
    projectId = project.body.id;
    serverId = await addServer(adaId, `vps-${runId}`, 'checked');
    bobServerId = await addServer(
      (bobRes.body as { user: { id: string } }).user.id,
      `bob-${runId}`,
      'ready',
    );
  });

  afterAll(async () => {
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
    await prisma.user.deleteMany({ where: { email: { contains: `dep-${runId}` } } });
    await prisma.githubInstallation.deleteMany({
      where: { githubInstallationId: BigInt(INSTALL) },
    });
    await app.close();
  });

  describe('env vars', () => {
    const env = (): string => `/projects/${projectId}/env`;

    it('saves pasted variables encrypted and lists them without values', async () => {
      const res = await http()
        .put(env())
        .set('Cookie', ada)
        .send({
          vars: [
            { key: 'DATABASE_URL', value: 'postgres://u:secret-pw@db/app', scope: 'runtime' },
            { key: 'NEXT_PUBLIC_API', value: 'https://api.example.com', scope: 'build' },
            { key: 'MULTI', value: 'line1\nline2', scope: 'both' },
          ],
        })
        .expect(200);
      const items = (res.body as { items: { key: string }[] }).items;
      expect(items.map((v) => v.key)).toEqual(['DATABASE_URL', 'MULTI', 'NEXT_PUBLIC_API']);
      expect(JSON.stringify(res.body)).not.toContain('secret-pw');

      const stored = await prisma.envVar.findMany({ where: { projectId } });
      expect(stored).toHaveLength(3);
      for (const row of stored) expect(row.encryptedValue).toMatch(/^v1\./);
      expect(JSON.stringify(stored)).not.toContain('secret-pw');
    });

    it('reveals a value and updates one', async () => {
      const revealed = await http().get(`${env()}/MULTI/value`).set('Cookie', ada).expect(200);
      expect(revealed.body).toEqual({ key: 'MULTI', value: 'line1\nline2' });

      await http()
        .put(env())
        .set('Cookie', ada)
        .send({ vars: [{ key: 'MULTI', value: 'changed', scope: 'runtime' }] })
        .expect(200);
      const after = await http().get(`${env()}/MULTI/value`).set('Cookie', ada).expect(200);
      expect(after.body.value).toBe('changed');
    });

    it('changes the scope without the value, and deletes', async () => {
      const res = await http()
        .patch(`${env()}/MULTI`)
        .set('Cookie', ada)
        .send({ scope: 'both' })
        .expect(200);
      expect(res.body).toMatchObject({ key: 'MULTI', scope: 'both' });
      await http().delete(`${env()}/MULTI`).set('Cookie', ada).expect(204);
      await http().get(`${env()}/MULTI/value`).set('Cookie', ada).expect(404);
    });

    it('rejects reserved and invalid names', async () => {
      await http()
        .put(env())
        .set('Cookie', ada)
        .send({ vars: [{ key: 'PORT', value: '1', scope: 'runtime' }] })
        .expect(400);
      await http()
        .put(env())
        .set('Cookie', ada)
        .send({ vars: [{ key: 'BAD-NAME', value: '1', scope: 'runtime' }] })
        .expect(400);
    });

    it("hides other users' variables", async () => {
      await http().get(env()).set('Cookie', bob).expect(404);
      await http().get(`${env()}/DATABASE_URL/value`).set('Cookie', bob).expect(404);
    });
  });

  describe('choosing a server', () => {
    it('refuses deploying without a server', async () => {
      const res = await http()
        .post(`/projects/${projectId}/deployments`)
        .set('Cookie', ada)
        .expect(400);
      expect(res.body.code).toBe('NO_SERVER');
    });

    it("refuses someone else's server", async () => {
      await http()
        .patch(`/projects/${projectId}`)
        .set('Cookie', ada)
        .send({ serverId: bobServerId })
        .expect(400);
    });

    it('sets the server and health check path', async () => {
      const res = await http()
        .patch(`/projects/${projectId}`)
        .set('Cookie', ada)
        .send({ serverId, healthCheckPath: '/health' })
        .expect(200);
      expect(res.body).toMatchObject({
        server: { id: serverId, status: 'checked' },
        healthCheckPath: '/health',
        liveDeployment: null,
        latestDeployment: null,
      });
      await http()
        .patch(`/projects/${projectId}`)
        .set('Cookie', ada)
        .send({ healthCheckPath: 'no-slash' })
        .expect(400);
    });

    it('refuses deploying to a server that is not set up', async () => {
      const res = await http()
        .post(`/projects/${projectId}/deployments`)
        .set('Cookie', ada)
        .expect(400);
      expect(res.body.code).toBe('SERVER_NOT_READY');
      await prisma.server.update({ where: { id: serverId }, data: { status: 'ready' } });
    });
  });

  describe('deployments', () => {
    let deploymentId = '';

    it('queues a deployment of the branch head', async () => {
      const res = await http()
        .post(`/projects/${projectId}/deployments`)
        .set('Cookie', ada)
        .expect(202);
      expect(res.body).toMatchObject({
        status: 'queued',
        trigger: 'manual',
        branch: 'main',
        commit: { message: 'Latest commit on main', author: 'ada' },
        server: { id: serverId },
        url: null,
        stages: {},
        cancelRequested: false,
      });
      expect(res.body.commit.sha).toMatch(/^[0-9a-f]{40}$/);
      deploymentId = res.body.id;

      const job = await queue.getJob(deploymentId);
      expect(job?.name).toBe(DeploymentQueueJob.RUN);
      expect(job?.data).toEqual({ deploymentId }); // nothing secret in Redis
    });

    it('allows one deployment at a time', async () => {
      const res = await http()
        .post(`/projects/${projectId}/deployments`)
        .set('Cookie', ada)
        .expect(409);
      expect(res.body.code).toBe('DEPLOYMENT_IN_PROGRESS');
    });

    it('shows the latest deployment on the project', async () => {
      const res = await http().get(`/projects/${projectId}`).set('Cookie', ada).expect(200);
      expect(res.body.latestDeployment).toMatchObject({ id: deploymentId, status: 'queued' });
    });

    it('cancels a queued deployment and ends its stream', async () => {
      const res = await http()
        .post(`/projects/${projectId}/deployments/${deploymentId}/cancel`)
        .set('Cookie', ada)
        .expect(202);
      expect(res.body).toMatchObject({ status: 'cancelled', cancelRequested: true });
      expect(await queue.getJob(deploymentId)).toBeUndefined();

      const events = await readEvents(
        http().get(`/projects/${projectId}/deployments/${deploymentId}/stream`).set('Cookie', ada),
      );
      expect(events.at(-1)).toEqual({ type: 'end', status: 'cancelled', error: null });

      await http()
        .post(`/projects/${projectId}/deployments/${deploymentId}/cancel`)
        .set('Cookie', ada)
        .expect(409);
    });

    it('asks a running deployment to stop (the worker does the rest)', async () => {
      const running = await prisma.deployment.create({
        data: {
          projectId,
          serverId,
          branch: 'main',
          commitSha: 'a'.repeat(40),
          commitMessage: 'x',
          status: 'building',
          startedAt: new Date(),
        },
      });
      const res = await http()
        .post(`/projects/${projectId}/deployments/${running.id}/cancel`)
        .set('Cookie', ada)
        .expect(202);
      expect(res.body).toMatchObject({ status: 'building', cancelRequested: true });

      await prisma.deployment.update({ where: { id: running.id }, data: { status: 'switching' } });
      await http()
        .post(`/projects/${projectId}/deployments/${running.id}/cancel`)
        .set('Cookie', ada)
        .expect(409);
      await prisma.deployment.delete({ where: { id: running.id } });
    });

    it('replays the saved (chunked) log of a finished deployment', async () => {
      const finished = await prisma.deployment.create({
        data: {
          projectId,
          serverId,
          branch: 'main',
          commitSha: 'b'.repeat(40),
          commitMessage: 'y',
          status: 'failed',
          failedStage: 'building',
          errorSummary: 'The build failed.',
          stages: {
            cloning: { startedAt: '2026-10-16T10:00:00Z', finishedAt: '2026-10-16T10:00:02Z' },
          },
          imageTag: 'selfship/p-x:bbbbbbb-abcdef',
          startedAt: new Date(),
          logChunks: {
            create: [
              { seq: 0, content: '→ Fetching\n✓ Source fetched\n' },
              { seq: 1, content: 'npm ERR! missing script\n' },
            ],
          },
        },
      });
      const events = await readEvents(
        http().get(`/projects/${projectId}/deployments/${finished.id}/stream`).set('Cookie', ada),
      );
      expect(events).toEqual([
        { type: 'line', line: '→ Fetching' },
        { type: 'line', line: '✓ Source fetched' },
        { type: 'line', line: 'npm ERR! missing script' },
        { type: 'end', status: 'failed', error: 'The build failed.' },
      ]);

      const dto = await http()
        .get(`/projects/${projectId}/deployments/${finished.id}`)
        .set('Cookie', ada)
        .expect(200);
      expect(dto.body).toMatchObject({
        failedStage: 'building',
        stages: { cloning: { finishedAt: '2026-10-16T10:00:02Z' } },
      });
    });

    it('lists deployments, newest first', async () => {
      const res = await http()
        .get(`/projects/${projectId}/deployments`)
        .set('Cookie', ada)
        .expect(200);
      expect(res.body.items.length).toBeGreaterThanOrEqual(2);
      expect(res.body.items[0].status).toBe('failed');
    });

    it("hides other users' deployments", async () => {
      await http().get(`/projects/${projectId}/deployments`).set('Cookie', bob).expect(404);
      await http()
        .get(`/projects/${projectId}/deployments/${deploymentId}/stream`)
        .set('Cookie', bob)
        .expect(404);
      await http().post(`/projects/${projectId}/deployments`).set('Cookie', bob).expect(404);
    });

    describe('redeploy and rollback', () => {
      /** Inserts a finished deployment that built an image. */
      const finished = (
        status: 'live' | 'replaced',
        imageTag: string,
        minutesAgo: number,
      ): Promise<{ id: string }> =>
        prisma.deployment.create({
          data: {
            projectId,
            serverId,
            branch: 'main',
            commitSha: imageTag.slice(-1).repeat(40),
            commitMessage: `build ${imageTag}`,
            status,
            imageTag,
            startedAt: new Date(Date.now() - minutesAgo * 60_000),
            finishedAt: new Date(Date.now() - minutesAgo * 60_000),
          },
        });

      it('redeploys a specific commit', async () => {
        const sha = String(REPO_ID).padEnd(40, 'c').slice(0, 40);
        const res = await http()
          .post(`/projects/${projectId}/deployments`)
          .set('Cookie', ada)
          .send({ commitSha: sha })
          .expect(202);
        expect(res.body).toMatchObject({ trigger: 'manual', commit: { sha } });
        await http()
          .post(`/projects/${projectId}/deployments/${res.body.id}/cancel`)
          .set('Cookie', ada)
          .expect(202);
        await http()
          .post(`/projects/${projectId}/deployments`)
          .set('Cookie', ada)
          .send({ commitSha: 'not-a-sha' })
          .expect(400);
      });

      it('offers rollback only for replaced deployments whose image is still kept', async () => {
        // Newest first: live (a), then replaced b, c, d. Only 3 images are kept: a, b, c.
        await finished('replaced', 'selfship/p-x:d', 40);
        await finished('replaced', 'selfship/p-x:c', 30);
        const b = await finished('replaced', 'selfship/p-x:b', 20);
        await finished('live', 'selfship/p-x:a', 10);

        const list = await http()
          .get(`/projects/${projectId}/deployments`)
          .set('Cookie', ada)
          .expect(200);
        const available = (
          list.body.items as { commit: { message: string }; rollbackAvailable: boolean }[]
        )
          .filter((d) => d.rollbackAvailable)
          .map((d) => d.commit.message);
        expect(available.sort()).toEqual(['build selfship/p-x:b', 'build selfship/p-x:c']);

        const res = await http()
          .post(`/projects/${projectId}/deployments/${b.id}/rollback`)
          .set('Cookie', ada)
          .expect(202);
        expect(res.body).toMatchObject({
          trigger: 'rollback',
          status: 'queued',
          sourceDeploymentId: b.id,
          commit: { sha: 'b'.repeat(40) },
        });
        const job = await queue.getJob(res.body.id);
        expect(job?.data).toEqual({ deploymentId: res.body.id });
        await prisma.deployment.update({
          where: { id: res.body.id },
          data: { status: 'cancelled' },
        });
      });

      it('refuses rolling back to a live deployment or a cleaned-up image', async () => {
        const items = (await http().get(`/projects/${projectId}/deployments`).set('Cookie', ada))
          .body.items as { id: string; status: string; commit: { message: string } }[];
        const live = items.find((d) => d.status === 'live');
        const old = items.find((d) => d.commit.message === 'build selfship/p-x:d');
        for (const target of [live, old]) {
          const res = await http()
            .post(`/projects/${projectId}/deployments/${target?.id ?? ''}/rollback`)
            .set('Cookie', ada)
            .expect(409);
          expect(res.body.code).toBe('ROLLBACK_UNAVAILABLE');
        }
      });
    });

    describe('auto-deploy on push', () => {
      /** Sends a signed push webhook. */
      const push = (payload: object): request.Test => {
        const body = JSON.stringify(payload);
        const signature = `sha256=${createHmac('sha256', 'test-webhook-secret').update(body).digest('hex')}`;
        return http()
          .post('/webhooks/github')
          .set('Content-Type', 'application/json')
          .set('X-GitHub-Event', 'push')
          .set('X-Hub-Signature-256', signature)
          .send(body);
      };
      const event = (sha: string, overrides: Record<string, unknown> = {}): object => ({
        ref: 'refs/heads/main',
        after: sha,
        repository: { id: REPO_ID, full_name: 'acme/web' },
        installation: { id: INSTALL },
        head_commit: { id: sha, message: 'Fix header\n\nDetails', author: { username: 'ada' } },
        ...overrides,
      });
      const pushDeployments = (): Promise<Deployment[]> =>
        prisma.deployment.findMany({
          where: { projectId, trigger: 'push' },
          orderBy: { createdAt: 'asc' },
        });

      it('deploys the pushed commit', async () => {
        const res = await push(event('1'.repeat(40))).expect(202);
        expect(res.body).toEqual({ received: true, handled: 'push', deployments: 1 });
        const [deployment] = await pushDeployments();
        expect(deployment).toMatchObject({
          status: 'queued',
          commitSha: '1'.repeat(40),
          commitMessage: 'Fix header',
          commitAuthor: 'ada',
          triggeredById: null,
        });
        expect(await queue.getJob(deployment?.id ?? '')).toBeDefined();
      });

      it('ignores a redelivery of the same push', async () => {
        const res = await push(event('1'.repeat(40))).expect(202);
        expect(res.body.deployments).toBe(0);
        expect(await pushDeployments()).toHaveLength(1);
      });

      it('lets the newest push replace one that is still waiting', async () => {
        await push(event('2'.repeat(40))).expect(202);
        const [first, second] = await pushDeployments();
        expect(first?.status).toBe('cancelled');
        expect(second).toMatchObject({ status: 'queued', commitSha: '2'.repeat(40) });
        expect(await queue.getJob(first?.id ?? '')).toBeUndefined();
      });

      it('ignores other branches, deleted branches, tags, skip markers and other installations', async () => {
        const cases = [
          event('3'.repeat(40), { ref: 'refs/heads/develop' }),
          event('0'.repeat(40), { deleted: true, head_commit: null }),
          event('4'.repeat(40), { ref: 'refs/tags/v1.0.0' }),
          event('5'.repeat(40), {
            head_commit: { id: '5'.repeat(40), message: 'Docs only [skip deploy]' },
          }),
          event('6'.repeat(40), { installation: { id: INSTALL + 1 } }),
        ];
        for (const payload of cases) {
          const res = await push(payload).expect(202);
          expect(res.body.deployments).toBe(0);
        }
        expect(await pushDeployments()).toHaveLength(2);
      });

      it('respects the per-project toggle', async () => {
        const res = await http()
          .patch(`/projects/${projectId}`)
          .set('Cookie', ada)
          .send({ autoDeploy: false })
          .expect(200);
        expect(res.body.autoDeploy).toBe(false);
        expect((await push(event('7'.repeat(40))).expect(202)).body.deployments).toBe(0);
        await http()
          .patch(`/projects/${projectId}`)
          .set('Cookie', ada)
          .send({ autoDeploy: true })
          .expect(200);
        await prisma.deployment.updateMany({
          where: { projectId, status: 'queued' },
          data: { status: 'cancelled' },
        });
      });
    });

    it('removes the app from its servers when the project is deleted', async () => {
      await http().delete(`/projects/${projectId}`).set('Cookie', ada).expect(204);
      const job = await queue.getJob(`teardown-${projectId}-${serverId}`);
      expect(job?.name).toBe(DeploymentQueueJob.TEARDOWN);
      expect(job?.data).toEqual({ projectId, serverId });
    });
  });
});
