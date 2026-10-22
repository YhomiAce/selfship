import { reportError, scrubEvent } from './error-tracking';

describe('error tracking', () => {
  it('strips cookies, bodies, query strings, headers and user details', () => {
    const event = scrubEvent({
      type: undefined,
      request: {
        url: 'https://selfship.example.com/api/servers',
        cookies: { sid: 'session-token' },
        data: '{"password":"hunter2"}',
        query_string: 'token=abc',
        headers: { authorization: 'Bearer abc', cookie: 'sid=x', 'user-agent': 'Chrome' },
      },
      user: { email: 'ada@example.com', ip_address: '1.2.3.4' },
    });
    expect(event.request).toEqual({
      url: 'https://selfship.example.com/api/servers',
      headers: { 'user-agent': 'Chrome' },
    });
    expect(event.user).toBeUndefined();
    expect(JSON.stringify(event)).not.toMatch(/hunter2|session-token|Bearer|token=abc/);
  });

  it('does nothing when no DSN was configured', () => {
    expect(() => {
      reportError(new Error('boom'));
    }).not.toThrow();
  });
});
