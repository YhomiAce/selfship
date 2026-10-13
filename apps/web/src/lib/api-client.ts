import type { ApiError } from '@selfship/shared';

/** Error thrown by {@link apiFetch} for any non-2xx response. */
export class ApiRequestError extends Error {
  /**
   * @param status - HTTP status code
   * @param body - Parsed error body in the shared API error shape
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
 * Cookies are sent automatically (same origin). Non-2xx responses throw an
 * {@link ApiRequestError} carrying the shared error shape.
 *
 * @param path - API path starting with `/`, e.g. `/auth/me`
 * @param options - Fetch options; use `json` for request bodies
 * @returns The parsed JSON response, or `undefined` for 204 responses
 * @throws {ApiRequestError} When the API responds with an error status
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { json, headers, ...rest } = options;
  const response = await fetch(`/api${path}`, {
    ...rest,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
  });

  if (response.status === 204) return undefined as T;

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiRequestError(response.status, toApiError(response.status, body));
  }
  return body as T;
}

/** Normalises any error payload (including proxy/HTML errors) to {@link ApiError}. */
function toApiError(status: number, body: unknown): ApiError {
  if (body && typeof body === 'object' && 'code' in body && 'message' in body) {
    return body as ApiError;
  }
  return {
    statusCode: status,
    code: 'INTERNAL',
    message: 'The server could not be reached. Please try again.',
  };
}
