import type { Redis } from 'ioredis';
import type { GithubRepository } from '@selfship/github';
import type { GithubAppService } from './github-app.service';
import { GithubRepositoriesService } from './github-repositories.service';

const repo = (name: string, pushedAt: string | null): GithubRepository => ({
  id: name.length,
  name,
  fullName: `acme/${name}`,
  owner: 'acme',
  private: false,
  defaultBranch: 'main',
  pushedAt,
});

describe('GithubRepositoriesService', () => {
  const client = {
    listRepositories: jest.fn(),
    getRepository: jest.fn(),
    listBranches: jest.fn(),
  };
  const github = { client } as unknown as GithubAppService;
  const query = { page: 1, pageSize: 20 };

  beforeEach(() => jest.resetAllMocks());

  it('still lists repositories when Redis is down (sorted by last push)', async () => {
    const redis = {
      get: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      set: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    } as unknown as Redis;
    client.listRepositories.mockResolvedValue([
      repo('old', '2026-01-01'),
      repo('new', '2026-10-01'),
      repo('never', null),
    ]);

    const result = await new GithubRepositoriesService(github, redis).list(7, query);

    expect(result.items.map((r) => r.name)).toEqual(['new', 'old', 'never']);
  });

  it('serves from the cache without calling GitHub', async () => {
    const redis = {
      get: jest.fn().mockResolvedValue(JSON.stringify([repo('cached', null)])),
      set: jest.fn(),
    } as unknown as Redis;

    const result = await new GithubRepositoriesService(github, redis).list(7, {
      ...query,
      search: 'CACH',
    });

    expect(result.items.map((r) => r.name)).toEqual(['cached']);
    expect(client.listRepositories).not.toHaveBeenCalled();
  });

  it('puts the default branch first even if GitHub lists it later', async () => {
    const redis = {} as Redis;
    client.getRepository.mockResolvedValue(repo('web', null));
    client.listBranches.mockResolvedValue(['feature', 'main', 'alpha']);

    const result = await new GithubRepositoriesService(github, redis).branches(7, 'acme/web');

    expect(result).toEqual({ items: ['main', 'alpha', 'feature'], defaultBranch: 'main' });
  });
});
