import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { AppConfigService } from '../../config/app-config.service';
import { OriginGuard } from './origin.guard';

/** Builds an HTTP execution context for a request with the given method and Origin. */
function contextFor(method: string, origin?: string): ExecutionContext {
  const req = { method, get: (name: string) => (name === 'origin' ? origin : undefined) };
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('OriginGuard', () => {
  const config = { get: () => 'http://localhost:3000' } as unknown as AppConfigService;
  const guard = new OriginGuard(config);

  it('allows safe methods from anywhere', () => {
    expect(guard.canActivate(contextFor('GET', 'https://evil.example'))).toBe(true);
  });

  it('allows state-changing requests from the web origin', () => {
    expect(guard.canActivate(contextFor('POST', 'http://localhost:3000'))).toBe(true);
  });

  it('allows requests without an Origin header (non-browser clients)', () => {
    expect(guard.canActivate(contextFor('POST'))).toBe(true);
  });

  it('blocks state-changing requests from other origins', () => {
    expect(() => guard.canActivate(contextFor('POST', 'https://evil.example'))).toThrow(
      ForbiddenException,
    );
  });
});
