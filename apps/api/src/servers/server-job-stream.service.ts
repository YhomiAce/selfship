import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { serverJobStreamKey, type ServerJobEvent } from '@selfship/shared';
import { REDIS_CLIENT } from '../redis/redis.constants';

/** One log-stream entry: its Redis Stream ID (for resuming) and the event. */
export interface StreamEntry {
  id: string;
  event: ServerJobEvent;
}

/** How long one blocking read waits before returning (keeps connections healthy). */
const BLOCK_MS = 15_000;

/**
 * Reads a job's live log from its Redis Stream.
 *
 * Streams give us history and live updates in one ordered sequence: reading
 * from ID "0" returns every line so far, then blocking reads return new lines
 * as the worker appends them. Each entry's ID doubles as the SSE event ID, so
 * a browser that reconnects (sending `Last-Event-ID`) resumes exactly where
 * it stopped, with nothing lost or repeated.
 */
@Injectable()
export class ServerJobStreamService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Whether the job's stream exists (it expires a day after the job ends).
   *
   * @param jobId - Job ID
   * @returns True if live/recent log entries are available
   */
  async exists(jobId: string): Promise<boolean> {
    return (await this.redis.exists(serverJobStreamKey(jobId))) === 1;
  }

  /**
   * Yields entries after `fromId` until an `end` event or `signal` aborts.
   * Uses a dedicated connection, because blocking reads tie up a connection.
   *
   * @param jobId - Job ID
   * @param fromId - Stream ID to continue after ("0" = from the beginning)
   * @param signal - Aborted when the client disconnects
   * @returns Async iterator of entries
   */
  async *read(
    jobId: string,
    fromId: string,
    signal: AbortSignal,
  ): AsyncGenerator<StreamEntry | 'heartbeat'> {
    const key = serverJobStreamKey(jobId);
    const reader = this.redis.duplicate();
    let lastId = /^\d+-\d+$/.test(fromId) ? fromId : '0';
    try {
      while (!signal.aborted) {
        const result = await reader.xread('COUNT', 200, 'BLOCK', BLOCK_MS, 'STREAMS', key, lastId);
        if (!result) {
          yield 'heartbeat';
          continue;
        }
        for (const [, entries] of result) {
          for (const [id, fields] of entries) {
            lastId = id;
            const event = parseFields(fields);
            if (!event) continue;
            yield { id, event };
            if (event.type === 'end') return;
          }
        }
      }
    } finally {
      reader.disconnect();
    }
  }
}

/**
 * Converts a stream entry's flat field list (["type","line","line","..."])
 * into an event. Unknown shapes are skipped rather than crashing the stream.
 */
function parseFields(fields: string[]): ServerJobEvent | null {
  const map = new Map<string, string>();
  for (let i = 0; i + 1 < fields.length; i += 2) map.set(fields[i] ?? '', fields[i + 1] ?? '');
  const type = map.get('type');
  if (type === 'line') return { type: 'line', line: map.get('line') ?? '' };
  if (type === 'end') {
    const status = map.get('status');
    return {
      type: 'end',
      status: status === 'succeeded' ? 'succeeded' : 'failed',
      error: map.get('error') || null,
    };
  }
  return null;
}
