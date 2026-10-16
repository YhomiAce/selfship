import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';
import { generateKeyPair } from '@selfship/remote';
import { serverJobStreamKey } from '@selfship/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { MailService } from '../src/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';

/** A public IP that is never contacted by these tests (generated-key servers don't connect). */
const PUBLIC_IP = '13.50.208.142';

/** Extracts the session cookie from a response. */
function sessionCookie(res: request.Response): string {
  const cookie = (res.get('Set-Cookie') ?? []).find((c) => c.startsWith('sid='));
  if (!cookie) throw new Error('no session cookie');
  return cookie.split(';')[0] ?? '';
}

describe('Servers (e2e)', () => {
  let app: NestExpressApplication;
  let redis: Redis;
  let ada = '';
  let bob = '';
  const runId = randomUUID().slice(0, 8);
  const http = (): ReturnType<typeof request> => request(app.getHttpServer());
  const body = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    name: `vps-${runId}`,
    host: PUBLIC_IP,
    port: 22,
    sshUser: 'root',
    method: 'generated',
    ...overrides,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue({ send: () => Promise.resolve() })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
    configureApp(app);
    await app.init();
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6380');

    const register = async (name: string): Promise<string> =>
      sessionCookie(
        await http()
          .post('/auth/register')
          .send({
            name,
            email: `${name}+srv-${runId}@example.com`,
            password: 'correct horse battery',
          })
          .expect(201),
      );
    ada = await register('ada');
    bob = await register('bob');
  });

  afterAll(async () => {
    await app
      .get(PrismaService)
      .user.deleteMany({ where: { email: { contains: `srv-${runId}` } } });
    await redis.quit();
    await app.close();
  });

  let serverId = '';

  describe('adding a server', () => {
    it('with a generated key: waits for the user to add our public key', async () => {
      const res = await http().post('/servers').set('Cookie', ada).send(body()).expect(201);
      expect(res.body).toMatchObject({
        status: 'awaiting_key',
        keySource: 'generated',
        latestJob: null,
        hostKeyFingerprint: null,
      });
      expect(res.body.publicKey).toMatch(/^ssh-ed25519 \S+ selfship-[0-9a-f]{8}$/);
      expect(res.body.authorizeCommand).toContain(res.body.publicKey);
      expect(res.body.revokeCommand).toMatch(
        /^sed -i '\/ selfship-[0-9a-f]{8}\$\/d' ~\/.ssh\/authorized_keys$/,
      );
      expect(JSON.stringify(res.body)).not.toContain('PRIVATE KEY');
      serverId = res.body.id;
    });

    it('stores the private key encrypted', async () => {
      const row = await app
        .get(PrismaService)
        .server.findUniqueOrThrow({ where: { id: serverId } });
      expect(row.encryptedPrivateKey.startsWith('v1.')).toBe(true);
      expect(row.encryptedPrivateKey).not.toContain('PRIVATE KEY');
    });

    it('with a pasted key: validates it and queues setup immediately', async () => {
      const { privateKey } = generateKeyPair('test');
      const res = await http()
        .post('/servers')
        .set('Cookie', ada)
        .send(body({ name: `pasted-${runId}`, method: 'pasted', privateKey }))
        .expect(201);
      expect(res.body).toMatchObject({
        status: 'checking',
        keySource: 'pasted',
        latestJob: { type: 'setup', status: 'queued' },
      });
    });

    it('rejects invalid pasted keys on the field', async () => {
      const res = await http()
        .post('/servers')
        .set('Cookie', ada)
        .send(
          body({
            name: `bad-${runId}`,
            method: 'pasted',
            privateKey:
              '-----BEGIN OPENSSH PRIVATE KEY-----\nnope\n-----END OPENSSH PRIVATE KEY-----',
          }),
        )
        .expect(400);
      expect(res.body.code).toBe('INVALID_PRIVATE_KEY');
      expect(res.body.fieldErrors.privateKey).toBeDefined();
    });

    it.each(['127.0.0.1', '10.0.0.5', '169.254.169.254', '192.168.1.10'])(
      'refuses internal host %p (SSRF)',
      async (host) => {
        const res = await http()
          .post('/servers')
          .set('Cookie', ada)
          .send(body({ name: `x-${runId}`, host }))
          .expect(400);
        expect(res.body.code).toBe('FORBIDDEN_HOST');
        expect(res.body.fieldErrors.host).toBeDefined();
      },
    );

    it('validates fields per access method', async () => {
      const res = await http()
        .post('/servers')
        .set('Cookie', ada)
        .send(body({ method: 'password' }))
        .expect(400);
      expect(res.body.fieldErrors.password).toBeDefined();
      await http()
        .post('/servers')
        .set('Cookie', ada)
        .send(body({ sshUser: 'Root; rm -rf' }))
        .expect(400);
    });

    it('rejects duplicate names', async () => {
      const res = await http().post('/servers').set('Cookie', ada).send(body()).expect(409);
      expect(res.body.fieldErrors.name).toBeDefined();
    });
  });

  describe('ownership', () => {
    it('lists and fetches only your own servers', async () => {
      const mine = await http().get('/servers').set('Cookie', ada).expect(200);
      expect((mine.body as { items: unknown[] }).items.length).toBeGreaterThanOrEqual(2);
      const theirs = await http().get('/servers').set('Cookie', bob).expect(200);
      expect(theirs.body).toEqual({ items: [] });
      await http().get(`/servers/${serverId}`).set('Cookie', bob).expect(404);
      await http().post(`/servers/${serverId}/setup`).set('Cookie', bob).expect(404);
      await http().delete(`/servers/${serverId}`).set('Cookie', bob).expect(404);
    });
  });

  describe('jobs and live logs', () => {
    let jobId = '';

    it('queues a setup job and refuses a second one while it is pending', async () => {
      const res = await http().post(`/servers/${serverId}/setup`).set('Cookie', ada).expect(202);
      expect(res.body).toMatchObject({ type: 'setup', status: 'queued' });
      jobId = res.body.id;
      const again = await http().post(`/servers/${serverId}/check`).set('Cookie', ada).expect(409);
      expect(again.body.code).toBe('JOB_IN_PROGRESS');
      const server = await http().get(`/servers/${serverId}`).set('Cookie', ada).expect(200);
      expect(server.body).toMatchObject({ status: 'checking', latestJob: { id: jobId } });
    });

    it('streams the log as Server-Sent Events, ending with the result', async () => {
      // Play the worker's part: append lines and an end marker to the job's stream.
      const key = serverJobStreamKey(jobId);
      const add = (event: object): Promise<unknown> =>
        redis.xadd(key, '*', 'data', JSON.stringify(event));
      await add({ type: 'line', line: '→ Connecting' });
      await add({ type: 'line', line: '✓ Connected' });
      await add({ type: 'end', status: 'succeeded', error: null });

      const res = await http()
        .get(`/servers/${serverId}/jobs/${jobId}/stream`)
        .set('Cookie', ada)
        .buffer(true)
        .parse((response, done) => {
          let text = '';
          response.on('data', (chunk: Buffer) => (text += chunk.toString()));
          response.on('end', () => {
            done(null, text);
          });
        })
        .expect(200);
      expect(res.get('Content-Type')).toContain('text/event-stream');
      const events = String(res.body)
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map(
          (line) => JSON.parse(line.slice(6)) as { type: string; line?: string; status?: string },
        );
      expect(events).toEqual([
        { type: 'line', line: '→ Connecting' },
        { type: 'line', line: '✓ Connected' },
        { type: 'end', status: 'succeeded', error: null },
      ]);
      expect(String(res.body)).toMatch(/^id: \d+-\d+$/m); // event IDs allow resuming
      await redis.del(key);
    });

    it('replays the saved log once the live stream has expired', async () => {
      await app.get(PrismaService).serverJob.update({
        where: { id: jobId },
        data: {
          status: 'failed',
          error: 'Boom',
          log: 'line one\nline two\n',
          finishedAt: new Date(),
        },
      });
      const res = await http()
        .get(`/servers/${serverId}/jobs/${jobId}/stream`)
        .set('Cookie', ada)
        .buffer(true)
        .parse((response, done) => {
          let text = '';
          response.on('data', (chunk: Buffer) => (text += chunk.toString()));
          response.on('end', () => {
            done(null, text);
          });
        })
        .expect(200);
      expect(String(res.body)).toContain('"line one"');
      expect(String(res.body)).toContain('"type":"end","status":"failed","error":"Boom"');
    });

    it("hides other users' job logs", async () => {
      await http().get(`/servers/${serverId}/jobs/${jobId}/stream`).set('Cookie', bob).expect(404);
      await http().get(`/servers/${serverId}/jobs/${jobId}`).set('Cookie', bob).expect(404);
    });

    it('lists jobs and returns the saved log', async () => {
      const list = await http().get(`/servers/${serverId}/jobs`).set('Cookie', ada).expect(200);
      expect((list.body as { items: { id: string }[] }).items[0]?.id).toBe(jobId);
      const job = await http()
        .get(`/servers/${serverId}/jobs/${jobId}`)
        .set('Cookie', ada)
        .expect(200);
      expect(job.body).toMatchObject({ status: 'failed', log: 'line one\nline two\n' });
    });
  });

  it('removes a server and explains how to revoke our key', async () => {
    const res = await http().delete(`/servers/${serverId}`).set('Cookie', ada).expect(200);
    expect(res.body.revokeCommand).toMatch(/selfship-[0-9a-f]{8}/);
    await http().get(`/servers/${serverId}`).set('Cookie', ada).expect(404);
  });
});
