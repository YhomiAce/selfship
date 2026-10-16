import { capabilityTier, parsePreflight } from './preflight';

/** Builds pre-flight output with overrides. */
function output(overrides: Record<string, string> = {}): string {
  const facts: Record<string, string> = {
    OS: 'Ubuntu 24.04.5 LTS',
    OS_ID: 'ubuntu',
    OS_VERSION: '24.04',
    ARCH: 'x86_64',
    CPUS: '2',
    RAM_MB: '1905',
    SWAP_MB: '0',
    DISK_FREE_GB: '16',
    SUDO: 'yes',
    DOCKER: '',
    PORTS: '',
    ...overrides,
  };
  return Object.entries(facts)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

describe('parsePreflight', () => {
  it('reads a healthy server', () => {
    const report = parsePreflight(output());
    expect(report).toMatchObject({
      osId: 'ubuntu',
      ramMb: 1905,
      cpus: 2,
      sudo: true,
      dockerVersion: null,
      tier: 'recommended',
    });
    expect(report.problems).toEqual([]);
  });

  it('flags unsupported OS, architecture, missing sudo and low disk', () => {
    const report = parsePreflight(
      output({
        OS: 'Debian 11',
        OS_ID: 'debian',
        OS_VERSION: '11',
        ARCH: 'armv7l',
        SUDO: 'no',
        DISK_FREE_GB: '2',
      }),
    );
    expect(report.problems).toHaveLength(4);
  });

  it('names the program blocking ports 80/443 and explains the fix', () => {
    const report = parsePreflight(output({ PORTS: '0.0.0.0:80(users:(("nginx",pid=1,fd=6)))' }));
    expect(report.problems[0]).toContain('nginx');
    expect(report.problems[0]).toContain('systemctl disable --now nginx');
  });

  it('ignores ports held by our own Traefik/Docker', () => {
    expect(
      parsePreflight(output({ PORTS: '0.0.0.0:80(users:(("docker-proxy",pid=1)))' })).problems,
    ).toEqual([]);
  });

  it('survives empty or garbage output', () => {
    const report = parsePreflight('random noise\n');
    expect(report.os).toBe('unknown');
    expect(report.problems.length).toBeGreaterThan(0);
  });
});

describe('swap warning', () => {
  it('says swap will be added when there is none', () => {
    expect(parsePreflight(output({ RAM_MB: '909', SWAP_MB: '0' })).warnings[0]).toContain(
      'will be added',
    );
  });

  it('says swap is in place when it already exists', () => {
    expect(parsePreflight(output({ RAM_MB: '909', SWAP_MB: '2047' })).warnings[0]).toContain(
      '2047 MB swap in place',
    );
  });
});

describe('capabilityTier', () => {
  it.each([
    [512, 'static_only'],
    [909, 'standard'],
    [1905, 'recommended'],
    [3900, 'recommended'],
  ])('%p MB → %p', (ram, tier) => {
    expect(capabilityTier(ram)).toBe(tier);
  });
});
