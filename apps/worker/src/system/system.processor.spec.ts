import type { Job, Queue } from 'bullmq';
import type { PingJobData } from '@selfship/shared';
import type { SandboxExpiryService } from '../deployments/sandbox-expiry.service';
import { SystemProcessor } from './system.processor';

/** Builds a minimal fake job for the processor. */
function fakeJob(name: string, data: PingJobData): Job<PingJobData, string> {
  return { name, data } as Job<PingJobData, string>;
}

describe('SystemProcessor', () => {
  const sandbox = { expire: () => Promise.resolve(2) } as unknown as SandboxExpiryService;
  const processor = new SystemProcessor(sandbox, {} as Queue);

  it('replies to ping', async () => {
    const reply = await processor.process(fakeJob('ping', { sentAt: new Date().toISOString() }));
    expect(reply).toMatch(/^pong/);
  });

  it('removes expired sandbox apps', async () => {
    await expect(processor.process(fakeJob('expire-sandbox', { sentAt: '' }))).resolves.toBe(
      'removed 2 expired sandbox app(s)',
    );
  });

  it('fails unknown jobs', async () => {
    await expect(processor.process(fakeJob('nope', { sentAt: '' }))).rejects.toThrow('Unknown');
  });
});
