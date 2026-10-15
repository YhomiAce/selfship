import type { Request } from 'express';
import { queryString, readCookie } from './http';

/** Fake request with the given `cookies` value. */
const withCookies = (cookies: unknown): Request => ({ cookies }) as unknown as Request;

describe('readCookie', () => {
  it('returns string cookie values', () => {
    expect(readCookie(withCookies({ sid: 'abc' }), 'sid')).toBe('abc');
  });

  it.each([
    ['cookie-parser missing', undefined],
    ['null cookies', null],
    ['missing cookie', {}],
    ['empty value', { sid: '' }],
    ['JSON cookie parsed into an object', { sid: { a: 1 } }],
  ])('returns undefined for %s', (_label, cookies) => {
    expect(readCookie(withCookies(cookies), 'sid')).toBeUndefined();
  });
});

describe('queryString', () => {
  it('accepts plain strings', () => {
    expect(queryString('code')).toBe('code');
  });

  it.each([[undefined], [''], [['a', 'b']], [{ a: '1' }], [42]])('rejects %p', (value) => {
    expect(queryString(value)).toBeUndefined();
  });
});
