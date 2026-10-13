import type { Job } from 'bullmq';
import type { PingJobData } from '@platform/shared';
import { SystemProcessor } from './system.processor';

/** Builds a minimal fake job for the processor. */
function fakeJob(name: string, data: PingJobData): Job<PingJobData, string> {
  return { name, data } as Job<PingJobData, string>;
}

describe('SystemProcessor', () => {
  const processor = new SystemProcessor();

  it('replies to ping', async () => {
    const reply = await processor.process(fakeJob('ping', { sentAt: new Date().toISOString() }));
    expect(reply).toMatch(/^pong/);
  });

  it('fails unknown jobs', async () => {
    await expect(processor.process(fakeJob('nope', { sentAt: '' }))).rejects.toThrow('Unknown');
  });
});
