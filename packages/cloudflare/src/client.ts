import { z } from 'zod';

/** Configuration for {@link CloudflareDnsClient}. */
export interface CloudflareConfig {
  /** API token with "Zone → DNS → Edit" permission on the zone. */
  apiToken: string;
  /** Zone ID (Cloudflare dashboard → domain → Overview → API). */
  zoneId: string;
  /** API base URL. Default `https://api.cloudflare.com/client/v4`. */
  apiUrl?: string;
  /** Per-request timeout in ms. Default 15 000. */
  timeoutMs?: number;
  /** Injectable fetch (tests). */
  fetch?: typeof fetch;
}

/** An A record. */
export interface DnsRecord {
  id: string;
  name: string;
  content: string;
}

/** Cloudflare refused or failed a request. Never contains the token. */
export class CloudflareApiError extends Error {
  override name = 'CloudflareApiError';

  /**
   * @param message - What failed (method, path, status, Cloudflare's error messages)
   * @param status - HTTP status (0 for network errors)
   */
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// Cloudflare wraps every response in { success, errors, result }; responses are validated.
const ErrorsSchema = z
  .array(z.object({ code: z.number().optional(), message: z.string() }))
  .catch([]);
const RecordSchema = z.object({ id: z.string(), name: z.string(), content: z.string() });

/**
 * Creates, updates and deletes the A records of platform subdomains
 * (`<project>.selfship.app` → server IP). Records are "DNS only" (not
 * proxied), so requests and Let's Encrypt's HTTP challenge reach the
 * user's server directly.
 */
export class CloudflareDnsClient {
  private readonly apiUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  /**
   * @param config - Token, zone and options
   */
  constructor(private readonly config: CloudflareConfig) {
    this.apiUrl = (config.apiUrl ?? 'https://api.cloudflare.com/client/v4').replace(/\/+$/, '');
    this.timeoutMs = config.timeoutMs ?? 15_000;
    this.fetchImpl = config.fetch ?? fetch;
  }

  /**
   * Creates an A record, or updates the existing one with that name.
   *
   * @param name - Full hostname, e.g. `shop.selfship.app`
   * @param ipv4 - Server IP
   * @param comment - Shown in the Cloudflare dashboard (e.g. the project ID)
   * @returns The record
   */
  async upsertA(name: string, ipv4: string, comment: string): Promise<DnsRecord> {
    const body = { type: 'A', name, content: ipv4, ttl: 60, proxied: false, comment };
    const existing = await this.findA(name);
    return existing
      ? this.request('PUT', `/dns_records/${encodeURIComponent(existing.id)}`, RecordSchema, body)
      : this.request('POST', '/dns_records', RecordSchema, body);
  }

  /**
   * Finds the A record with this exact name.
   *
   * @param name - Full hostname
   * @returns The record, or null
   */
  async findA(name: string): Promise<DnsRecord | null> {
    const params = new URLSearchParams({ type: 'A', name, per_page: '5' });
    const records = await this.request(
      'GET',
      `/dns_records?${params.toString()}`,
      z.array(RecordSchema),
    );
    return records.find((record) => record.name === name) ?? null;
  }

  /**
   * Deletes a record. Already-deleted records are fine.
   *
   * @param id - Record ID
   */
  async delete(id: string): Promise<void> {
    try {
      await this.request(
        'DELETE',
        `/dns_records/${encodeURIComponent(id)}`,
        z.object({ id: z.string() }),
      );
    } catch (error) {
      if (error instanceof CloudflareApiError && error.status === 404) return;
      throw error;
    }
  }

  /** Sends a request and unwraps Cloudflare's envelope. */
  private async request<T>(
    method: string,
    path: string,
    schema: z.ZodType<T>,
    body?: object,
  ): Promise<T> {
    const label = `${method} ${path.split('?')[0] ?? ''}`;
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.apiUrl}/zones/${encodeURIComponent(this.config.zoneId)}${path}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${this.config.apiToken}`,
            'Content-Type': 'application/json',
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
    } catch (error) {
      const reason =
        error instanceof Error && error.name === 'TimeoutError' ? 'timed out' : 'network error';
      throw new CloudflareApiError(`Cloudflare ${label}: ${reason}`, 0);
    }
    const parsed = z
      .object({ success: z.boolean(), errors: ErrorsSchema, result: schema.nullable() })
      .safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) {
      throw new CloudflareApiError(
        `Cloudflare ${label}: HTTP ${response.status}, unexpected response`,
        response.status,
      );
    }
    const { success, errors, result } = parsed.data;
    if (!response.ok || !success || result === null) {
      const detail = errors.map((e) => e.message).join('; ') || `HTTP ${response.status}`;
      throw new CloudflareApiError(`Cloudflare ${label}: ${detail}`, response.status);
    }
    return result;
  }
}
