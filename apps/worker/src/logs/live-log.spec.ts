import type { Redis } from 'ioredis';
import { JobLog } from './job-log';

/** Records xadd/expire calls like a minimal Redis. */
function fakeRedis(): { redis: Redis; entries: string[][]; expired: string[] } {
  const entries: string[][] = [];
  const expired: string[] = [];
  const redis = {
    xadd: (...args: string[]) => {
      entries.push(args);
      return Promise.resolve('1-0');
    },
    expire: (key: string) => {
      expired.push(key);
      return Promise.resolve(1);
    },
  } as unknown as Redis;
  return { redis, entries, expired };
}

describe('JobLog', () => {
  it('streams lines in order and keeps the full text', async () => {
    const { redis, entries, expired } = fakeRedis();
    const log = new JobLog(redis, 'job-1');
    log.line('first');
    log.line('second\r');
    log.line('   ');
    await log.end('succeeded', null);

    expect(log.contents).toBe('first\nsecond\n');
    const lines = entries.filter((e) => e.includes('line')).map((e) => e[e.length - 1]);
    expect(lines).toEqual(['first', 'second']);
    expect(entries.at(-1)).toEqual([
      'selfship:server-job:job-1:log',
      '*',
      'type',
      'end',
      'status',
      'succeeded',
      'error',
      '',
    ]);
    expect(expired).toEqual(['selfship:server-job:job-1:log']);
  });

  it('keeps working (saved log intact) when Redis is down', async () => {
    const redis = {
      xadd: () => Promise.reject(new Error('down')),
      expire: () => Promise.reject(new Error('down')),
    } as unknown as Redis;
    const log = new JobLog(redis, 'job-2');
    log.line('still recorded');
    await expect(log.end('failed', 'x')).resolves.toBeUndefined();
    expect(log.contents).toBe('still recorded\n');
  });

  it('truncates very long logs once, with a note', () => {
    const { redis } = fakeRedis();
    const log = new JobLog(redis, 'job-3');
    for (let i = 0; i < 4000; i++) log.line('x'.repeat(100));
    expect(log.contents.length).toBeLessThan(270 * 1024);
    expect(log.contents.match(/log truncated/g)).toHaveLength(1);
  });
});
