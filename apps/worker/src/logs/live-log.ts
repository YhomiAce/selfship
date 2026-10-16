import type { Redis } from 'ioredis';
import { Masker } from './masker';

/** Options for {@link LiveLog}. */
export interface LiveLogOptions {
  /** Live entries kept in the stream (oldest dropped beyond this). Default 5 000. */
  maxEntries?: number;
  /** Saved log size limit; later lines are dropped with a note. Default 256 KB. */
  maxSavedChars?: number;
  /** Values to hide from every line and message. */
  secrets?: Iterable<string>;
}

/** How long the live stream stays readable after the job ends. */
const STREAM_TTL_SECONDS = 24 * 60 * 60;

/**
 * A job's output: each event is appended to a Redis Stream immediately (so
 * the dashboard shows it live), and lines are kept in memory for the saved
 * log. Every entry is one `data` field holding the event as JSON, so the API
 * can relay any job's stream without knowing its event types.
 *
 * Secrets passed in the options are masked before anything is written.
 */
export class LiveLog<TEvent extends { type: string }> {
  private readonly masker: Masker;
  private readonly maxEntries: number;
  private readonly maxSavedChars: number;
  private text = '';
  private savedUpTo = 0;
  private truncated = false;
  /** Writes are chained so entries arrive in order even though XADD is async. */
  private pending: Promise<unknown> = Promise.resolve();

  /**
   * @param redis - Redis client
   * @param key - Stream key (see `serverJobStreamKey` / `deploymentStreamKey`)
   * @param options - Limits and secrets
   */
  constructor(
    private readonly redis: Redis,
    private readonly key: string,
    options: LiveLogOptions = {},
  ) {
    this.masker = new Masker(options.secrets ?? []);
    this.maxEntries = options.maxEntries ?? 5_000;
    this.maxSavedChars = options.maxSavedChars ?? 256 * 1024;
  }

  /**
   * Adds output. Text with several lines becomes several entries; blank lines are skipped.
   *
   * @param text - Output (secrets are masked)
   */
  line(text: string): void {
    for (const raw of this.masker.mask(text).split('\n')) {
      const clean = raw.replace(/\r/g, '').trimEnd();
      if (!clean) continue;
      if (this.text.length + clean.length < this.maxSavedChars) {
        this.text += `${clean}\n`;
      } else if (!this.truncated) {
        this.truncated = true;
        this.text += '… (log truncated; the rest is on the server)\n';
      }
      this.write({ type: 'line', line: clean });
    }
  }

  /**
   * Adds a non-line event (e.g. a stage change).
   *
   * @param event - Event (string fields are masked)
   */
  event(event: TEvent): void {
    this.write(event);
  }

  /**
   * Writes the final event and lets the stream expire.
   *
   * @param event - End event
   */
  async end(event: TEvent): Promise<void> {
    this.write(event);
    await this.pending;
    try {
      await this.redis.expire(this.key, STREAM_TTL_SECONDS);
    } catch {
      // Best-effort: the dashboard falls back to the saved log.
    }
  }

  /**
   * Masks secrets in text that isn't part of the log (e.g. an error summary).
   *
   * @param text - Any text
   * @returns Masked text
   */
  mask(text: string): string {
    return this.masker.mask(text);
  }

  /** Everything logged so far. */
  get contents(): string {
    return this.text;
  }

  /**
   * Text added since the previous call, for saving the log in chunks.
   *
   * @returns New text ('' if none)
   */
  takeUnsaved(): string {
    const chunk = this.text.slice(this.savedUpTo);
    this.savedUpTo = this.text.length;
    return chunk;
  }

  /** Appends one entry; live streaming is best-effort (the saved log is the record). */
  private write(event: object): void {
    const data = this.masker.mask(JSON.stringify(event));
    this.pending = this.pending
      .then(() => this.redis.xadd(this.key, 'MAXLEN', '~', this.maxEntries, '*', 'data', data))
      .catch(() => undefined);
  }
}
