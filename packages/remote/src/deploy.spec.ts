import { execFileSync } from 'node:child_process';
import type { DeploymentStage } from '@selfship/shared';
import {
  AppDeployer,
  DeployCancelledError,
  DeployError,
  type DeployPlan,
  exportLines,
  teardownApp,
} from './deploy';
import type { CommandRunner, ExecOptions, ExecResult } from './ssh';
import { RemoteCommandError } from './ssh';

const SHA = 'abcdef1234567890abcdef1234567890abcdef12';
const TOKEN = 'ghs_SECRETTOKEN123';
const DB_PASSWORD = 'p@ss w0rd\'"$(rm -rf /)';

/** A plan for a Node app with one build-time and one runtime secret. */
function plan(overrides: Partial<DeployPlan> = {}): DeployPlan {
  return {
    app: 'p-0123456789ab',
    deploymentId: '11111111-2222-3333-4444-555555555555',
    source: {
      kind: 'git',
      cloneUrl: 'https://github.com/acme/web.git',
      sha: SHA,
      rootDirectory: '',
      token: TOKEN,
    },
    settings: {
      adapter: 'node',
      installCommand: 'npm ci',
      buildCommand: null,
      startCommand: 'npm start',
      outputDirectory: null,
      port: 3000,
      nodeVersion: 22,
    },
    host: 'web-0123ab.13-50-208-142.sslip.io',
    healthCheckPath: '/health',
    env: { build: { NEXT_PUBLIC_API: 'https://api' }, runtime: { DB_PASSWORD } },
    ...overrides,
  };
}

interface Call {
  command: string;
  options: ExecOptions;
}

/**
 * Fake server: answers by matching the command; records every call.
 * `fail` makes the first matching command exit non-zero.
 */
class FakeServer implements CommandRunner {
  readonly calls: Call[] = [];
  health = 'true healthy 0';
  httpCode = '200';
  existing = 'p-0123456789ab-20260101000000-aaaaaa';
  fail: RegExp | null = null;
  /** Whether `docker image inspect` finds the image (rollbacks). */
  imagePresent = true;
  /** Called when a command matches `onCommand.pattern` (e.g. to cancel mid-build). */
  onCommand: { pattern: RegExp; run: () => Promise<void> } | null = null;

  async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    this.calls.push({ command, options });
    if (this.onCommand?.pattern.test(command)) {
      const hook = this.onCommand;
      this.onCommand = null;
      await hook.run();
    }
    if (this.fail?.test(command)) {
      if (options.check === false) return { code: 1, stdout: '', stderr: 'boom' };
      throw new RemoteCommandError('cmd', 1, 'error: something broke');
    }
    if (command.startsWith('ls -A1')) return ok('package.json\npackage-lock.json\n');
    if (command.includes('cat ') && command.includes('package.json')) {
      return ok(JSON.stringify({ name: 'web', scripts: { start: 'node index.js' } }));
    }
    if (command.startsWith('docker image inspect')) {
      return this.imagePresent ? ok('') : { code: 1, stdout: '', stderr: '' };
    }
    if (command.startsWith('docker inspect -f')) return ok(this.health);
    if (command.includes('curl -s')) return ok(this.httpCode);
    if (command.startsWith('docker ps -a'))
      return ok(`${this.existing}\n${options.sudo ? '' : ''}`);
    if (command.startsWith('docker logs')) return ok('Error: listen EADDRINUSE');
    if (command.startsWith('df -P')) return ok('42');
    if (command.startsWith('docker run') || command.includes('docker build')) {
      options.onOutput?.('#1 [internal] load build definition\n#2 DONE', 'stdout');
      options.onOutput?.(' 0.1s\n', 'stdout');
    }
    return ok('');
  }

  /** Every command line we sent, joined (to check secrets never appear in them). */
  get commandText(): string {
    return this.calls.map((call) => call.command).join('\n');
  }
}

function ok(stdout: string): ExecResult {
  return { code: 0, stdout, stderr: '' };
}

const FAST = { healthTimeoutMs: 200, healthPollMs: 1, switchSettleMs: 0 };

/** Deployer over the fake server, recording log lines and stages. */
function makeDeployer(
  server: FakeServer,
  overrides: Partial<DeployPlan> = {},
): { deployer: AppDeployer; lines: string[]; stages: DeploymentStage[] } {
  const lines: string[] = [];
  const stages: DeploymentStage[] = [];
  const deployer = new AppDeployer(
    server,
    plan(overrides),
    {
      log: (line) => {
        lines.push(line);
      },
      stage: (stage) => {
        stages.push(stage);
        return Promise.resolve();
      },
    },
    FAST,
  );
  return { deployer, lines, stages };
}

describe('AppDeployer', () => {
  it('runs every stage, switches traffic and stops the old version', async () => {
    const server = new FakeServer();
    const { deployer, lines, stages } = makeDeployer(server);

    const outcome = await deployer.run();

    expect(stages).toEqual(['cloning', 'building', 'starting', 'health_check', 'switching']);
    expect(outcome.imageTag).toMatch(/^selfship\/p-0123456789ab:abcdef1-[0-9a-f]{6}$/);
    expect(outcome.replacedContainers).toEqual([server.existing]);
    expect(server.commandText).toContain(`docker stop -t 10 '${server.existing}'`);
    // Streamed build output is re-assembled into whole lines.
    expect(lines).toContain('#2 DONE 0.1s');

    const build = server.calls.find((c) => c.command.includes('docker build'))?.command ?? '';
    expect(build).toContain('--build-arg NEXT_PUBLIC_API');
    const run = server.calls.find((c) => c.command.includes('docker run'))?.command ?? '';
    expect(run).toContain('-e DB_PASSWORD');
    expect(run).toContain('--network selfship');
    expect(run).toContain('Host(`web-0123ab.13-50-208-142.sslip.io`)');
    expect(server.commandText).toContain("'/health'");
  });

  it('never puts the GitHub token or variable values in a command line', async () => {
    const server = new FakeServer();
    await makeDeployer(server).deployer.run();

    expect(server.commandText).not.toContain(TOKEN);
    expect(server.commandText).not.toContain('p@ss');
    expect(server.commandText).not.toContain('https://api');
    // The token travels on stdin of the clone step only.
    const withToken = server.calls.filter((c) => c.options.stdin?.includes(TOKEN));
    expect(withToken).toHaveLength(1);
    expect(withToken[0]?.command).toContain('git fetch');
    // Env files are root-only.
    const envWrites = server.calls.filter((c) => /^install .*env\.sh'$/.test(c.command));
    expect(envWrites.map((c) => c.command)).toEqual([
      expect.stringContaining("install -D -m '600'"),
      expect.stringContaining("install -D -m '600'"),
    ]);
  });

  it('clones only the project folder of a monorepo', async () => {
    const server = new FakeServer();
    await makeDeployer(server, {
      source: {
        kind: 'git',
        cloneUrl: 'https://github.com/acme/web.git',
        sha: SHA,
        rootDirectory: 'apps/web',
        token: TOKEN,
      },
    }).deployer.run();
    const clone = server.calls.find((c) => c.command.includes('git fetch'))?.command ?? '';
    expect(clone).toContain('sparse-checkout set');
    expect(clone).toContain('--filter=blob:none');
  });

  it('keeps the old version when the build fails', async () => {
    const server = new FakeServer();
    server.fail = /docker build/;
    const { deployer, stages } = makeDeployer(server);

    await expect(deployer.run()).rejects.toMatchObject({ name: 'DeployError', stage: 'building' });
    expect(stages.at(-1)).toBe('building');
    expect(server.commandText).not.toContain('docker stop');
    expect(server.commandText).not.toContain('docker run');
    // Sources and env files are removed even on failure.
    expect(server.calls.at(-1)?.command).toMatch(/^rm -rf .*build-env\.sh.*run-env\.sh/);
  });

  it('removes the new container and keeps the old one when health checks fail', async () => {
    const server = new FakeServer();
    server.httpCode = '502';
    const { deployer } = makeDeployer(server);

    const error = await deployer.run().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DeployError);
    expect((error as DeployError).stage).toBe('health_check');
    expect((error as DeployError).message).toContain('last response: HTTP 502');
    expect((error as DeployError).message).toContain('EADDRINUSE');
    expect(server.commandText).toContain(`docker rm -f '${deployer.containerName}'`);
    expect(server.commandText).not.toContain('docker stop');
  });

  it('reports an app that crashes on start', async () => {
    const server = new FakeServer();
    server.health = 'true starting 2';
    await expect(makeDeployer(server).deployer.run()).rejects.toThrow(
      'exited right after starting',
    );
  });

  it('cancels a running build by killing its process group', async () => {
    const server = new FakeServer();
    const { deployer } = makeDeployer(server);
    server.onCommand = {
      pattern: /docker build/,
      run: async () => {
        await deployer.cancel();
      },
    };
    server.fail = /docker build/; // the killed build exits non-zero

    await expect(deployer.run()).rejects.toBeInstanceOf(DeployCancelledError);
    expect(server.commandText).toMatch(/kill -TERM -- -"\$\(cat '.*\/pid'\)"/);
    expect(server.commandText).not.toContain('docker run');
  });

  it('rolls back to an existing image without cloning or building', async () => {
    const server = new FakeServer();
    const imageTag = 'selfship/p-0123456789ab:abcdef1-aaaaaa';
    const { deployer, stages } = makeDeployer(server, { source: { kind: 'image', imageTag } });

    const outcome = await deployer.run();

    expect(stages).toEqual(['starting', 'health_check', 'switching']);
    expect(outcome.imageTag).toBe(imageTag);
    expect(server.commandText).not.toContain('git fetch');
    expect(server.commandText).not.toContain('docker build');
    const run = server.calls.find((c) => c.command.includes('docker run'))?.command ?? '';
    expect(run).toContain(`'${imageTag}'`);
    expect(run).toContain('-e DB_PASSWORD'); // current runtime variables
  });

  it('explains a rollback whose image was cleaned up', async () => {
    const server = new FakeServer();
    server.imagePresent = false;
    const { deployer } = makeDeployer(server, {
      source: { kind: 'image', imageTag: 'selfship/p-0123456789ab:abcdef1-aaaaaa' },
    });
    await expect(deployer.run()).rejects.toMatchObject({
      stage: 'starting',
      message: expect.stringContaining('Redeploy its commit instead'),
    });
    expect(server.commandText).not.toContain('docker run');
  });

  it("refuses to roll back to another app's image", () => {
    expect(() =>
      makeDeployer(new FakeServer(), { source: { kind: 'image', imageTag: 'selfship/p-other:x' } }),
    ).toThrow("this app's own images");
  });

  it('refuses unsafe plans', () => {
    const server = new FakeServer();
    expect(() => makeDeployer(server, { app: 'Bad App' })).toThrow('Invalid app ID');
    expect(() => makeDeployer(server, { host: 'x`) || Host(`evil.com' })).toThrow('Invalid host');
    expect(() =>
      makeDeployer(server, { env: { build: {}, runtime: { 'BAD-NAME': 'x' } } }),
    ).toThrow('Invalid variable name');
  });
});

describe('exportLines', () => {
  it('round-trips any value through a real shell', () => {
    const vars = {
      PLAIN: 'hello',
      TRICKY: DB_PASSWORD,
      MULTILINE: '-----BEGIN KEY-----\nabc\n-----END KEY-----',
      EMPTY: '',
    };
    const script = `${exportLines(vars)}node -e 'console.log(JSON.stringify({PLAIN:process.env.PLAIN,TRICKY:process.env.TRICKY,MULTILINE:process.env.MULTILINE,EMPTY:process.env.EMPTY}))'`;
    const output = execFileSync('bash', ['-c', script], { env: { PATH: process.env.PATH } });
    expect(JSON.parse(output.toString())).toEqual(vars);
  });
});

describe('teardownApp', () => {
  it('removes containers, images and files of one app only', async () => {
    const server = new FakeServer();
    await teardownApp(server, 'p-0123456789ab');
    const command = server.calls[0]?.command ?? '';
    expect(command).toContain("'label=selfship.app=p-0123456789ab'");
    expect(command).toContain("docker images 'selfship/p-0123456789ab'");
    expect(command).toContain("rm -rf '/opt/selfship/apps/p-0123456789ab'");
    await expect(teardownApp(server, '../etc')).rejects.toThrow('Invalid app ID');
  });
});
