import { StageClock } from './stage-clock';

describe('StageClock', () => {
  it('closes each stage when the next starts, and the last one on stop', () => {
    const clock = new StageClock();
    clock.enter('cloning', new Date('2026-10-16T10:00:00Z'));
    clock.enter('building', new Date('2026-10-16T10:00:05Z'));
    clock.stop(new Date('2026-10-16T10:01:00Z'));
    clock.stop(new Date('2026-10-16T10:09:00Z')); // second stop changes nothing

    expect(clock.current).toBe('building');
    expect(clock.toJSON()).toEqual({
      cloning: { startedAt: '2026-10-16T10:00:00.000Z', finishedAt: '2026-10-16T10:00:05.000Z' },
      building: { startedAt: '2026-10-16T10:00:05.000Z', finishedAt: '2026-10-16T10:01:00.000Z' },
    });
  });
});
