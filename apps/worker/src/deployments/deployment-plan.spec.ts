import { appId, envVarContext, previewHost, resolveIpv4, splitEnv } from './deployment-plan';

describe('deployment plan helpers', () => {
  const projectId = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';

  it('derives a stable DNS-safe app ID', () => {
    expect(appId(projectId)).toBe('p-1a2b3c4d5e6f');
  });

  it('builds the temporary hostname', () => {
    expect(previewHost('web', projectId, '13.50.208.142', 'sslip.io')).toBe(
      'web-1a2b3c.13-50-208-142.sslip.io',
    );
  });

  it('keeps IPs as they are', async () => {
    await expect(resolveIpv4('51.21.45.144')).resolves.toBe('51.21.45.144');
  });

  it('splits variables by scope', () => {
    expect(
      splitEnv([
        { key: 'SECRET', value: 's', scope: 'runtime' },
        { key: 'NEXT_PUBLIC_API', value: 'a', scope: 'build' },
        { key: 'SHARED', value: 'b', scope: 'both' },
      ]),
    ).toEqual({
      build: { NEXT_PUBLIC_API: 'a', SHARED: 'b' },
      runtime: { SECRET: 's', SHARED: 'b' },
    });
  });

  it('binds env values to project and name', () => {
    expect(envVarContext(projectId, 'DB_URL')).toBe(`project:${projectId}:env:DB_URL`);
  });
});
