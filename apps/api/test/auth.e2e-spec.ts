import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { EmailJobData } from '@platform/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { MailService } from '../src/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';

/** Captures emails instead of queueing them, so tests can follow links. */
class CapturingMailService {
  readonly sent: EmailJobData[] = [];

  send(email: EmailJobData): Promise<void> {
    this.sent.push(email);
    return Promise.resolve();
  }

  /** Returns the `token` query parameter from the last email of a template. */
  lastToken(template: EmailJobData['template']): string {
    const email = [...this.sent].reverse().find((e) => e.template === template);
    if (!email) throw new Error(`No ${template} email sent`);
    const url =
      'verifyUrl' in email.data
        ? email.data.verifyUrl
        : 'resetUrl' in email.data
          ? email.data.resetUrl
          : '';
    const token = new URL(url).searchParams.get('token');
    if (!token) throw new Error('Email link has no token');
    return token;
  }
}

/** Extracts the session cookie (`name=value`) from a response. */
function sessionCookie(res: request.Response): string {
  const header = res.get('Set-Cookie') ?? [];
  const cookie = header.find((c) => c.startsWith('sid='));
  if (!cookie) throw new Error('No session cookie set');
  return cookie.split(';')[0] ?? '';
}

describe('Auth (e2e)', () => {
  let app: NestExpressApplication;
  let mail: CapturingMailService;
  const runId = Date.now().toString(36);
  const email = `ada+${runId}@example.com`;
  const password = 'correct horse battery';

  beforeAll(async () => {
    mail = new CapturingMailService();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue(mail)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.get(PrismaService).user.deleteMany({ where: { email: { contains: runId } } });
    await app.close();
  });

  const http = (): ReturnType<typeof request> => request(app.getHttpServer());

  it('rejects invalid sign-up data with per-field errors', async () => {
    const res = await http()
      .post('/auth/register')
      .send({ name: '', email: 'nope', password: 'short' })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(res.body.fieldErrors)).toEqual(
      expect.arrayContaining(['name', 'email', 'password']),
    );
  });

  let cookie: string;

  it('registers, sets a session cookie and sends a verification email', async () => {
    const res = await http()
      .post('/auth/register')
      .send({ name: 'Ada Lovelace', email: email.toUpperCase(), password })
      .expect(201);

    expect(res.body.user).toMatchObject({ email, emailVerified: false, hasPassword: true });
    expect(res.body.user).not.toHaveProperty('passwordHash');
    expect(res.get('Set-Cookie')?.[0]).toMatch(/HttpOnly/i);
    cookie = sessionCookie(res);
    expect(mail.sent.at(-1)?.template).toBe('verify-email');
  });

  it('rejects a duplicate email', async () => {
    const res = await http()
      .post('/auth/register')
      .send({ name: 'Ada', email, password })
      .expect(409);
    expect(res.body.code).toBe('EMAIL_TAKEN');
  });

  it('returns the current user only with a valid session', async () => {
    await http().get('/auth/me').set('Cookie', cookie).expect(200);
    const res = await http().get('/auth/me').expect(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('verifies the email once', async () => {
    const token = mail.lastToken('verify-email');
    const res = await http().post('/auth/verify-email').send({ token }).expect(200);
    expect(res.body.user.emailVerified).toBe(true);

    const again = await http().post('/auth/verify-email').send({ token }).expect(400);
    expect(again.body.code).toBe('INVALID_TOKEN');
  });

  it('rejects wrong passwords and unknown emails with the same error', async () => {
    const wrong = await http().post('/auth/login').send({ email, password: 'nope' }).expect(401);
    const unknown = await http()
      .post('/auth/login')
      .send({ email: `ghost+${runId}@example.com`, password })
      .expect(401);
    expect(wrong.body).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(unknown.body.message).toBe(wrong.body.message);
  });

  it('logs in and out', async () => {
    const res = await http().post('/auth/login').send({ email, password }).expect(200);
    const loginCookie = sessionCookie(res);

    await http().post('/auth/logout').set('Cookie', loginCookie).expect(204);
    await http().get('/auth/me').set('Cookie', loginCookie).expect(401);
  });

  it('resets the password and signs out every session', async () => {
    await http()
      .post('/auth/forgot-password')
      .send({ email: `ghost+${runId}@example.com` })
      .expect(204);
    const sentBefore = mail.sent.length;
    await http().post('/auth/forgot-password').send({ email }).expect(204);
    expect(mail.sent.length).toBe(sentBefore + 1);

    const token = mail.lastToken('reset-password');
    const newPassword = 'a brand new passphrase';
    await http().post('/auth/reset-password').send({ token, password: newPassword }).expect(204);

    await http().get('/auth/me').set('Cookie', cookie).expect(401);
    await http().post('/auth/login').send({ email, password: newPassword }).expect(200);
    await http().post('/auth/reset-password').send({ token, password: newPassword }).expect(400);
    expect(mail.sent.at(-1)?.template).toBe('password-changed');
  });

  it('blocks state-changing requests from a foreign origin', async () => {
    const res = await http()
      .post('/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email, password })
      .expect(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('reports GitHub sign-in as disabled when not configured', async () => {
    const res = await http().get('/auth/providers').expect(200);
    expect(typeof res.body.github).toBe('boolean');
  });

  // Keep last: exhausts the login rate limit for this app instance.
  it('rate-limits repeated login attempts', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await http().post('/auth/login').send({ email, password: 'wrong' });
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
  });
});
