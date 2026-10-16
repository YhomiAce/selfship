import type { DeploymentStage, StageTiming } from '@selfship/shared';

/** Records when each pipeline stage started and finished. */
export class StageClock {
  private readonly timings: Partial<Record<DeploymentStage, StageTiming>> = {};
  private active: DeploymentStage | null = null;

  /** The stage in progress (or the last one, after {@link stop}). */
  get current(): DeploymentStage | null {
    return this.active;
  }

  /**
   * Ends the current stage and starts the next.
   *
   * @param stage - Stage that starts now
   * @param now - Clock (tests)
   */
  enter(stage: DeploymentStage, now = new Date()): void {
    this.stop(now);
    this.timings[stage] = { startedAt: now.toISOString(), finishedAt: null };
    this.active = stage;
  }

  /**
   * Ends the current stage (the deployment finished or failed).
   *
   * @param now - Clock (tests)
   */
  stop(now = new Date()): void {
    const timing = this.active ? this.timings[this.active] : undefined;
    if (timing && !timing.finishedAt) timing.finishedAt = now.toISOString();
  }

  /** Timings as stored in `Deployment.stages` (plain JSON). */
  toJSON(): Record<string, Record<'startedAt' | 'finishedAt', string | null>> {
    const json: Record<string, Record<'startedAt' | 'finishedAt', string | null>> = {};
    for (const [stage, timing] of Object.entries(this.timings)) {
      json[stage] = { startedAt: timing.startedAt, finishedAt: timing.finishedAt };
    }
    return json;
  }
}
