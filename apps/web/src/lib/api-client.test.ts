import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, ApiRequestError } from './api-client';

/** Stubs global fetch with a single response (or a network failure). */
function mockFetch(response: Response | Error): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Runs a request and returns the ApiRequestError it throws. */
async function failure(promise: Promise<unknown>): Promise<ApiRequestError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiRequestError) return error;
    throw error;
  }
  throw new Error('Expected the request to fail');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetch', () => {
  it('returns parsed JSON on success', async () => {
    mockFetch(json({ user: { id: '1' } }));
    await expect(apiFetch('/auth/me')).resolves.toEqual({ user: { id: '1' } });
  });

  it('returns undefined for 204', async () => {
    mockFetch(new Response(null, { status: 204 }));
    await expect(apiFetch('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('sends JSON bodies and keeps caller headers given as a Headers object', async () => {
    const fetchMock = mockFetch(json({ ok: true }));
    await apiFetch('/x', {
      method: 'POST',
      json: { a: 1 },
      headers: new Headers({ 'X-Test': '1' }),
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('X-Test')).toBe('1');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(init.body).toBe('{"a":1}');
  });

  it('turns API error bodies into ApiRequestError with field errors', async () => {
    mockFetch(
      json(
        {
          statusCode: 400,
          code: 'VALIDATION_FAILED',
          message: 'Some fields are invalid.',
          fieldErrors: { email: ['Enter a valid email address.'] },
        },
        400,
      ),
    );
    const error = await failure(apiFetch('/auth/register'));
    expect(error.status).toBe(400);
    expect(error.fieldErrors).toEqual({ email: ['Enter a valid email address.'] });
  });

  it('uses a generic message when the error body is not in the API shape', async () => {
    mockFetch(new Response('<html>Bad Gateway</html>', { status: 502 }));
    const error = await failure(apiFetch('/auth/me'));
    expect(error.body.code).toBe('INTERNAL');
    expect(error.fieldErrors).toEqual({});
  });

  it('rejects malformed fieldErrors instead of trusting them', async () => {
    mockFetch(json({ statusCode: 400, code: 'X', message: 'm', fieldErrors: 'oops' }, 400));
    const error = await failure(apiFetch('/x'));
    expect(error.fieldErrors).toEqual({});
  });

  it('reports network failures as status 0', async () => {
    mockFetch(new TypeError('Failed to fetch'));
    const error = await failure(apiFetch('/auth/me'));
    expect(error.status).toBe(0);
    expect(error.body.code).toBe('NETWORK_ERROR');
  });

  it('rejects a 200 response with an empty or non-JSON body', async () => {
    mockFetch(new Response('', { status: 200 }));
    const error = await failure(apiFetch('/auth/me'));
    expect(error.body.code).toBe('INVALID_RESPONSE');
  });
});
