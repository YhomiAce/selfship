import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';

describe('GET /health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports database and redis as up', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      dependencies: { database: 'up', redis: 'up' },
    });
  });

  it('returns the shared error shape for unknown routes', async () => {
    const res = await request(app.getHttpServer()).get('/does-not-exist').expect(404);
    expect(res.body).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect(typeof res.body.requestId).toBe('string');
  });
});
