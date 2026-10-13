/** Redis connection settings accepted by BullMQ and ioredis. */
export interface RedisConnectionOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
}

/**
 * Converts a `redis://user:pass@host:port/db` URL into connection options.
 *
 * BullMQ expects discrete options rather than a URL, so both the API and the
 * worker use this helper to read the single `REDIS_URL` setting.
 *
 * @param url - Redis URL (`redis://` or `rediss://`)
 * @returns Connection options for BullMQ / ioredis
 * @throws {Error} If the URL protocol is not `redis:` or `rediss:`
 */
export function redisConnectionFromUrl(url: string): RedisConnectionOptions {
  const parsed = new URL(url);
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error(`Unsupported Redis URL protocol: ${parsed.protocol}`);
  }

  const options: RedisConnectionOptions = {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
  };
  if (parsed.username) options.username = decodeURIComponent(parsed.username);
  if (parsed.password) options.password = decodeURIComponent(parsed.password);

  const dbIndex = parsed.pathname.replace('/', '');
  if (dbIndex) options.db = Number(dbIndex);

  return options;
}
