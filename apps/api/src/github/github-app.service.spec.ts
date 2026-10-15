import {
  BadGatewayException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { GithubApiError, type GithubAppClient } from '@selfship/github';
import { GithubAppService } from './github-app.service';

describe('GithubAppService', () => {
  const notFound = { code: 'REPO_NOT_ACCESSIBLE', message: 'nope' };
  const service = new GithubAppService({} as GithubAppClient);

  it('reports "not configured" when there is no client', () => {
    const unconfigured = new GithubAppService(null);
    expect(unconfigured.isConfigured).toBe(false);
    expect(() => unconfigured.client).toThrow(ServiceUnavailableException);
  });

  it.each([
    [404, NotFoundException],
    [401, ForbiddenException],
    [403, ForbiddenException],
    [0, BadGatewayException],
    [500, BadGatewayException],
    [502, BadGatewayException],
  ])('maps GitHub %p to %p', (status, type) => {
    expect(service.toHttpError(new GithubApiError('x', status), notFound)).toBeInstanceOf(type);
  });

  it('leaves non-GitHub errors untouched', () => {
    const error = new Error('db down');
    expect(service.toHttpError(error, notFound)).toBe(error);
  });
});
