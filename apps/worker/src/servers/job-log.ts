import type { Redis } from 'ioredis';
import { serverJobStreamKey } from '@selfship/shared';

/** Live entries kept per job (oldest dropped beyond this). */
const STREAM_MAX_ENTRIES = 5_000;
/** Saved log size limit; later lines are dropped with a note. */
const SAVED_LOG_MAX_CHARS = 256 * 1024;
/** How long the live stream stays readable after the job ends. */
const STREAM_TTL_SECONDS = 24 * 60 * 60;

/**
 * Collects a job's output: each line is appended to the job's Redis Stream
 * immediately (so the dashboard shows it live) and kept in memory for the
 * full log saved to the database when the job ends.
 */
export class JobLog {
  private readonly key: string;
  private text = '';
  private truncated = false;
  /** Writes are chained so lines arrive in order even though XADD is async. */
  private pending: Promise<unknown> = Promise.resolve();

  /**
   * @param redis - Redis client
   * @param jobId - Server job ID
   */
  constructor(
    private readonly redis: Redis,
    jobId: string,
  ) {
    this.key = serverJobStreamKey(jobId);
  }

  /**
   * Adds one line (secrets must never be passed here).
   *
   * @param line - Text without a trailing newline
   */
  line(line: string): void {
    const clean = line.replace(/\r/g, '').trimEnd();
    if (!clean) return;
    if (this.text.length + clean.length < SAVED_LOG_MAX_CHARS) {
      this.text += `${clean}\n`;
    } else if (!this.truncated) {
      this.truncated = true;
      this.text += '… (log truncated; see the server for the rest)\n';
    }
    this.pending = this.pending
      .then(() =>
        this.redis.xadd(
          this.key,
          'MAXLEN',
          '~',
          STREAM_MAX_ENTRIES,
          '*',
          'type',
          'line',
          'line',
          clean,
        ),
      )
      .catch(() => undefined); // live streaming is best-effort; the saved log is the record
  }

  /**
   * Marks the end of the stream and lets it expire.
   *
   * @param status - Final job status
   * @param error - Failure reason, if any
   */
  async end(status: 'succeeded' | 'failed', error: string | null): Promise<void> {
    await this.pending;
    try {
      await this.redis.xadd(this.key, '*', 'type', 'end', 'status', status, 'error', error ?? '');
      await this.redis.expire(this.key, STREAM_TTL_SECONDS);
    } catch {
      // Best-effort: the dashboard falls back to the saved log.
    }
  }

  /** Everything logged so far (saved to the database at the end). */
  get contents(): string {
    return this.text;
  }
}
