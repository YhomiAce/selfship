import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';

/** One stream entry: its Redis Stream ID (for resuming) and the event as JSON. */
export interface StreamEntry {
  id: string;
  data: string;
}

/** What {@link LogStreamService.relay} needs to know about the job. */
export interface RelayOptions {
  /** Redis Stream key of the job's log. */
  key: string;
  /** Whether the job has finished (its live stream may have expired). */
  finished: boolean;
  /**
   * Events to send when the live stream has expired, built from the saved
   * log: JSON strings, ending with the `end` event.
   */
  replay: () => Promise<string[]>;
}

/** How long one blocking read waits before returning (keeps connections healthy). */
const BLOCK_MS = 15_000;

/**
 * Relays a job's live log (server checks, deployments) from its Redis Stream
 * to the browser as Server-Sent Events.
 *
 * Streams give us history and live updates in one ordered sequence: reading
 * from ID "0" returns every entry so far, then blocking reads return new ones
 * as the worker appends them. Each entry's ID doubles as the SSE event ID, so
 * a browser that reconnects (sending `Last-Event-ID`) resumes exactly where
 * it stopped. The worker writes each event as one JSON `data` field, which is
 * forwarded as-is, so this service doesn't need to know the event types.
 */
@Injectable()
export class LogStreamService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Streams a job's log over SSE until it ends or the client disconnects.
   *
   * @param req - Incoming request (for `Last-Event-ID` and disconnects)
   * @param res - Response to stream into
   * @param options - Stream key, job state and saved-log fallback
   */
  async relay(req: Request, res: Response, options: RelayOptions): Promise<void> {
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      // no-transform: proxies must not compress/buffer; X-Accel-Buffering: same for nginx.
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    if (options.finished && (await this.redis.exists(options.key)) === 0) {
      // The live stream expired: replay the saved log once.
      for (const data of await options.replay()) res.write(`data: ${data}\n\n`);
      res.end();
      return;
    }

    const controller = new AbortController();
    req.on('close', () => {
      controller.abort();
    });
    for await (const entry of this.read(
      options.key,
      req.get('last-event-id') ?? '0',
      controller.signal,
    )) {
      if (entry === 'heartbeat') res.write(': keep-alive\n\n');
      else res.write(`id: ${entry.id}\ndata: ${entry.data}\n\n`);
    }
    res.end();
  }

  /**
   * Yields entries after `fromId` until an `end` event or `signal` aborts.
   * Uses a dedicated connection, because blocking reads tie up a connection.
   *
   * @param key - Stream key
   * @param fromId - Stream ID to continue after ("0" = from the beginning)
   * @param signal - Aborted when the client disconnects
   * @returns Async iterator of entries
   */
  async *read(
    key: string,
    fromId: string,
    signal: AbortSignal,
  ): AsyncGenerator<StreamEntry | 'heartbeat'> {
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
            const data = fieldValue(fields, 'data');
            if (!data) continue;
            yield { id, data };
            if (isEndEvent(data)) return;
          }
        }
      }
    } finally {
      reader.disconnect();
    }
  }
}

/** Value of a field in a stream entry's flat list (["data","{…}"]). */
function fieldValue(fields: string[], name: string): string | null {
  for (let i = 0; i + 1 < fields.length; i += 2)
    if (fields[i] === name) return fields[i + 1] ?? null;
  return null;
}

/** Whether an entry is the job's last one. Malformed entries are not. */
function isEndEvent(data: string): boolean {
  try {
    const parsed: unknown = JSON.parse(data);
    return (
      typeof parsed === 'object' && parsed !== null && 'type' in parsed && parsed.type === 'end'
    );
  } catch {
    return false;
  }
}
