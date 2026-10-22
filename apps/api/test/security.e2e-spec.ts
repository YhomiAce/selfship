import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { totpCode } from '../src/auth/totp';
import { configureApp } from '../src/configure-app';
import { MailService } from '../src/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';

const runId = randomUUID().slice(0, 8);
const email = `sec-${runId}@example.com`;
const password = 'correct horse battery';

/** Cookies set by a response, as a `Cookie` header value (name=value pairs). */
function cookies(res: request.Response): string {
  return (res.get('Set-Cookie') ?? [])
    .map((c) => c.split(';')[0] ?? '')
    .filter((c) => !c.endsWith('='))
    .join('; ');
}

/** The code for the current time step plus `offset` steps. */
function code(secret: string, offset = 0): string {
  return totpCode(secret, Math.floor(Date.now() / 30_000) + offset);
}

describe('Two-factor authentication and audit log (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let session = '';
  let secret = '';
  let recoveryCodes: string[] = [];
  const http = (): ReturnType<typeof request> => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue({ send: () => Promise.resolve() })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    const res = await http()
      .post('/auth/register')
      .send({ name: 'Sec', email, password })
      .expect(201);
    session = cookies(res);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  it('sets up and enables two-factor with recovery codes', async () => {
    const setup = await http().post('/auth/2fa/setup').set('Cookie', session).expect(200);
    expect(setup.body.otpauthUri).toMatch(/^otpauth:\/\/totp\/Selfship:/);
    secret = setup.body.secret;
    // The secret is stored encrypted.
    const stored = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(stored.totpSecret).toMatch(/^v1\./);
    expect(stored.totpSecret).not.toContain(secret);

    await http()
      .post('/auth/2fa/enable')
      .set('Cookie', session)
      .send({ code: '000000' })
      .expect(401);
    const enabled = await http()
      .post('/auth/2fa/enable')
      .set('Cookie', session)
      .send({ code: code(secret) })
      .expect(200);
    recoveryCodes = enabled.body.recoveryCodes;
    expect(recoveryCodes).toHaveLength(10);
    expect(recoveryCodes[0]).toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}$/);
    const me = await http().get('/auth/me').set('Cookie', session).expect(200);
    expect(me.body.user.twoFactorEnabled).toBe(true);
  });

  it('asks for a code after the password, without a session', async () => {
    await http().post('/auth/logout').set('Cookie', session).expect(204);
    const res = await http().post('/auth/login').send({ email, password }).expect(200);
    expect(res.body).toEqual({ twoFactorRequired: true });
    const set = res.get('Set-Cookie') ?? [];
    expect(set.some((c) => c.startsWith('sid='))).toBe(false);
    const challenge = set.find((c) => c.startsWith('two_factor_challenge='));
    expect(challenge).toContain('HttpOnly');
    session = cookies(res); // only the challenge for now
    await http().get('/auth/me').set('Cookie', session).expect(401);
  });

  it('refuses a wrong code, accepts the right one, then refuses its reuse', async () => {
    const wrong = await http()
      .post('/auth/2fa/verify')
      .set('Cookie', session)
      .send({ code: '123456' })
      .expect(401);
    expect(wrong.body.code).toBe('TWO_FACTOR_INVALID');

    // The code used to enable 2FA is spent; the next step's code (allowed drift) works.
    const next = code(secret, 1);
    const ok = await http()
      .post('/auth/2fa/verify')
      .set('Cookie', session)
      .send({ code: next })
      .expect(200);
    expect(ok.body.user.email).toBe(email);
    const signedIn = cookies(ok);
    await http().get('/auth/me').set('Cookie', signedIn).expect(200);

    // A new sign-in can't reuse the same code.
    const again = await http().post('/auth/login').send({ email, password }).expect(200);
    await http()
      .post('/auth/2fa/verify')
      .set('Cookie', cookies(again))
      .send({ code: next })
      .expect(401);
    session = signedIn;
  });

  it('signs in with a recovery code, once', async () => {
    const login = await http().post('/auth/login').send({ email, password }).expect(200);
    const recovery = recoveryCodes[0] ?? '';
    await http()
      .post('/auth/2fa/verify')
      .set('Cookie', cookies(login))
      .send({ recoveryCode: recovery.toUpperCase() })
      .expect(200);
    const again = await http().post('/auth/login').send({ email, password }).expect(200);
    await http()
      .post('/auth/2fa/verify')
      .set('Cookie', cookies(again))
      .send({ recoveryCode: recovery })
      .expect(401);
  });

  it('needs a valid code to turn two-factor off', async () => {
    await http()
      .post('/auth/2fa/disable')
      .set('Cookie', session)
      .send({ code: '000000' })
      .expect(401);
    // Let a fresh code count (the drift window's codes were all used above).
    await prisma.user.update({ where: { email }, data: { totpLastStep: null } });
    await http()
      .post('/auth/2fa/disable')
      .set('Cookie', session)
      .send({ code: code(secret) })
      .expect(204);
    const login = await http().post('/auth/login').send({ email, password }).expect(200);
    expect(login.body.user.twoFactorEnabled).toBe(false);
    expect(await prisma.recoveryCode.count({ where: { user: { email } } })).toBe(0);
  });

  it('lists the activity, newest first, with no secrets in it', async () => {
    await http().post('/auth/login').send({ email, password: 'wrong password' }).expect(401);
    const res = await http().get('/audit-events').set('Cookie', session).expect(200);
    const actions = (res.body.items as { action: string }[]).map((e) => e.action);
    expect(actions[0]).toBe('auth.login_failed');
    expect(actions).toEqual(
      expect.arrayContaining([
        'auth.two_factor_enabled',
        'auth.two_factor_failed',
        'auth.recovery_code_used',
        'auth.two_factor_disabled',
        'auth.login',
      ]),
    );
    expect(res.body.items[0]).toMatchObject({ ipAddress: expect.any(String), userAgent: null });
    expect(JSON.stringify(res.body)).not.toContain(secret);
    expect(JSON.stringify(res.body)).not.toContain(password);
  });

  it('keeps each account to its own activity', async () => {
    const other = await http()
      .post('/auth/register')
      .send({ name: 'Other', email: `other-${email}`, password })
      .expect(201);
    const res = await http().get('/audit-events').set('Cookie', cookies(other)).expect(200);
    expect(res.body.items).toEqual([]);
    await prisma.user.deleteMany({ where: { email: `other-${email}` } });
  });
});
