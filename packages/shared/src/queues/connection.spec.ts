import { redisConnectionFromUrl } from './connection';

describe('redisConnectionFromUrl', () => {
  it('parses host and port', () => {
    expect(redisConnectionFromUrl('redis://localhost:6380')).toEqual({
      host: 'localhost',
      port: 6380,
    });
  });

  it('parses credentials and database index', () => {
    expect(redisConnectionFromUrl('redis://user:p%40ss@cache:6379/2')).toEqual({
      host: 'cache',
      port: 6379,
      username: 'user',
      password: 'p@ss',
      db: 2,
    });
  });

  it('defaults the port to 6379', () => {
    expect(redisConnectionFromUrl('redis://cache').port).toBe(6379);
  });

  it('rejects non-redis protocols', () => {
    expect(() => redisConnectionFromUrl('http://cache:6379')).toThrow('Unsupported');
  });
});
