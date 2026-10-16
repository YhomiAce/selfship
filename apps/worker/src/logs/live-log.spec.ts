import type { Redis } from 'ioredis';
import { LiveLog } from './live-log';
import { MASK, Masker } from './masker';

type Event = { type: 'line'; line: string } | { type: 'end'; status: string; error: string | null };

/** Records xadd/expire calls like a minimal Redis. */
function fakeRedis(): { redis: Redis; data: unknown[]; expired: string[] } {
  const data: unknown[] = [];
  const expired: string[] = [];
  const redis = {
    xadd: (...args: (string | number)[]) => {
      data.push(JSON.parse(String(args.at(-1))));
      return Promise.resolve('1-0');
    },
    expire: (key: string) => {
      expired.push(key);
      return Promise.resolve(1);
    },
  } as unknown as Redis;
  return { redis, data, expired };
}

describe('LiveLog', () => {
  it('streams JSON events in order and keeps the full text', async () => {
    const { redis, data, expired } = fakeRedis();
    const log = new LiveLog<Event>(redis, 'stream-1');
    log.line('first');
    log.line('second\r\nthird');
    log.line('   ');
    await log.end({ type: 'end', status: 'succeeded', error: null });

    expect(log.contents).toBe('first\nsecond\nthird\n');
    expect(data).toEqual([
      { type: 'line', line: 'first' },
      { type: 'line', line: 'second' },
      { type: 'line', line: 'third' },
      { type: 'end', status: 'succeeded', error: null },
    ]);
    expect(expired).toEqual(['stream-1']);
  });

  it('masks secrets in lines, events and the saved text', async () => {
    const { redis, data } = fakeRedis();
    const log = new LiveLog<Event>(redis, 's', { secrets: ['hunter2pass', 'x'] });
    log.line('password=hunter2pass ok x');
    await log.end({ type: 'end', status: 'failed', error: 'bad hunter2pass' });
    expect(log.contents).toBe(`password=${MASK} ok x\n`);
    expect(JSON.stringify(data)).not.toContain('hunter2pass');
    expect(log.mask('hunter2pass!')).toBe(`${MASK}!`);
  });

  it('hands out unsaved text once, for chunked saving', () => {
    const { redis } = fakeRedis();
    const log = new LiveLog<Event>(redis, 's');
    log.line('a');
    expect(log.takeUnsaved()).toBe('a\n');
    expect(log.takeUnsaved()).toBe('');
    log.line('b');
    expect(log.takeUnsaved()).toBe('b\n');
  });

  it('keeps working (saved log intact) when Redis is down', async () => {
    const redis = {
      xadd: () => Promise.reject(new Error('down')),
      expire: () => Promise.reject(new Error('down')),
    } as unknown as Redis;
    const log = new LiveLog<Event>(redis, 's');
    log.line('still recorded');
    await expect(log.end({ type: 'end', status: 'failed', error: 'x' })).resolves.toBeUndefined();
    expect(log.contents).toBe('still recorded\n');
  });

  it('truncates very long logs once, with a note', () => {
    const { redis } = fakeRedis();
    const log = new LiveLog<Event>(redis, 's');
    for (let i = 0; i < 4000; i++) log.line('x'.repeat(100));
    expect(log.contents.length).toBeLessThan(270 * 1024);
    expect(log.contents.match(/log truncated/g)).toHaveLength(1);
  });
});

describe('Masker', () => {
  it('masks multiline secrets line by line and the longest match first', () => {
    const masker = new Masker(['-----BEGIN-----\nAAAABBBBCCCC\n-----END-----', 'abcd', 'abcdefgh']);
    expect(masker.mask('key line: AAAABBBBCCCC')).toBe(`key line: ${MASK}`);
    expect(masker.mask('abcdefgh')).toBe(MASK);
    expect(masker.mask('ab')).toBe('ab');
  });
});
