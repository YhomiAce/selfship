import { type ApiError, ApiErrorSchema, ErrorCode } from '@selfship/shared';

/**
 * Error thrown by {@link apiFetch} for any failed request.
 * `status` is 0 when the server could not be reached at all.
 */
export class ApiRequestError extends Error {
  /**
   * @param status - HTTP status code, or 0 for network failures
   * @param body - Error body in the shared API error shape
   */
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.message);
    this.name = 'ApiRequestError';
  }

  /** Per-field validation messages, if the API returned any. */
  get fieldErrors(): Record<string, string[]> {
    return this.body.fieldErrors ?? {};
  }
}

/** Options for {@link apiFetch}: standard fetch options plus a JSON body. */
export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  /** Serialised as JSON and sent with `Content-Type: application/json`. */
  json?: unknown;
}

/**
 * Calls the API from the browser through the `/api` rewrite.
 *
 * Every failure mode ends up as an {@link ApiRequestError}, so callers only
 * need one `catch`: network errors (status 0), error statuses, and
 * successful responses whose body isn't the JSON we expect.
 *
 * @param path - API path starting with `/`, e.g. `/auth/me`
 * @param options - Fetch options; use `json` for request bodies
 * @returns The parsed JSON response, or `undefined` for 204 responses
 * @throws {ApiRequestError} On any failure
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { json, headers: extraHeaders, ...rest } = options;

  // `new Headers()` accepts every HeadersInit form (object, array, Headers);
  // spreading a Headers instance into an object would silently drop them.
  const headers = new Headers(extraHeaders);
  headers.set('Accept', 'application/json');
  if (json !== undefined) headers.set('Content-Type', 'application/json');

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...rest,
      credentials: 'same-origin',
      headers,
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    });
  } catch {
    throw new ApiRequestError(0, {
      statusCode: 0,
      code: ErrorCode.NETWORK_ERROR,
      message: "Can't reach the server. Check your connection and try again.",
    });
  }

  if (response.status === 204) return undefined as T;

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiRequestError(response.status, toApiError(response.status, body));
  }

  // A 2xx with an empty or non-JSON body (e.g. an HTML error page from a
  // proxy) would otherwise surface later as "cannot read property of null".
  if (body === null || typeof body !== 'object') {
    throw new ApiRequestError(response.status, {
      statusCode: response.status,
      code: ErrorCode.INVALID_RESPONSE,
      message: 'The server sent an unexpected response. Please try again.',
    });
  }

  return body as T;
}

/**
 * Normalises an error payload to {@link ApiError}. Bodies that don't match
 * the shared shape (proxy errors, HTML pages) get a generic message.
 */
function toApiError(status: number, body: unknown): ApiError {
  const parsed = ApiErrorSchema.safeParse(body);
  if (parsed.success) return parsed.data;
  return {
    statusCode: status,
    code: ErrorCode.INTERNAL,
    message:
      status >= 500
        ? 'The server had a problem. Please try again in a moment.'
        : 'The request failed. Please try again.',
  };
}
