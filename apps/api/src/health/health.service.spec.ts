import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { HealthService } from './health.service';

describe('HealthService', () => {
  const prisma = { $queryRaw: jest.fn() };
  const redis = { ping: jest.fn() };
  let service: HealthService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: PrismaService, useValue: prisma },
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();
    service = moduleRef.get(HealthService);
  });

  it('reports ok when all dependencies are up', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    redis.ping.mockResolvedValue('PONG');

    const result = await service.check();

    expect(result.status).toBe('ok');
    expect(result.dependencies).toEqual({ database: 'up', redis: 'up' });
  });

  it('reports degraded when the database is down', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
    redis.ping.mockResolvedValue('PONG');

    const result = await service.check();

    expect(result.status).toBe('degraded');
    expect(result.dependencies.database).toBe('down');
  });

  it('reports degraded when redis is down', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    redis.ping.mockRejectedValue(new Error('timeout'));

    expect((await service.check()).dependencies.redis).toBe('down');
  });
});
