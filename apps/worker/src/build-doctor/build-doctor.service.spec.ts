import type { Queue } from 'bullmq';
import type { Diagnosis, DiagnoseJobData } from '@selfship/shared';
import type { AppConfigService } from '../config/app-config.service';
import type { DeploymentLauncher } from '../domains/deployment-launcher.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ServerConnector } from '../servers/server-connector';
import { BuildDoctorService } from './build-doctor.service';
import { type DiagnosisModel, type ModelAnswer, NoDiagnosisError } from './claude';

/** A diagnosis row as the fake database keeps it. */
interface Row {
  id: string;
  deploymentId: string;
  projectId: string;
  userId: string;
  status: string;
  fingerprint?: string | null;
  result?: unknown;
  cached?: boolean;
  model?: string | null;
  error?: string | null;
  autoRemediation?: string | null;
  createdAt: Date;
}

const diagnosis = (overrides: Partial<Diagnosis> = {}): Diagnosis => ({
  category: 'user_code',
  summary: 'An import points to a file that does not exist.',
  rootCause: 'Header.js is imported as ./header.',
  evidence: ["Module not found: Can't resolve './header'"],
  fixSteps: ['Rename the import to ./Header.'],
  suggestedPatch: null,
  remediation: null,
  confidence: 'high',
  ...overrides,
});

/** What the tests inspect after running the service. */
interface Harness {
  service: BuildDoctorService;
  rows: Row[];
  sent: string[];
  queued: DiagnoseJobData[];
  commands: string[];
  retries: string[];
}

/** In-memory stand-in for the Prisma calls the service makes. */
function setup(
  options: { model?: DiagnosisModel | null; dailyLimit?: number; autoRetry?: boolean } = {},
): Harness {
  const rows: Row[] = [];
  const deployment = {
    id: 'dep-1',
    projectId: 'proj-1',
    status: 'failed',
    failedStage: 'building',
    errorSummary: 'The build failed.',
    hintTitle: null,
    hintAdvice: null,
    commitSha: 'a'.repeat(40),
    autoRetry: options.autoRetry ?? false,
    server: {
      id: 'srv-1',
      os: 'Ubuntu 24.04',
      arch: 'x86_64',
      ramMb: 909,
      swapMb: 0,
      diskFreeGb: 3,
    },
    project: {
      id: 'proj-1',
      userId: 'user-1',
      buildDoctor: true,
      adapter: 'spa',
      installCommand: 'npm ci',
      buildCommand: 'npm run build',
      startCommand: null,
      outputDirectory: 'build',
      port: 80,
      nodeVersion: 22,
      rootDirectory: '',
      healthCheckPath: '/',
      repoFullName: 'acme/web',
      githubInstallation: { githubInstallationId: 7n },
      envVars: [{ key: 'API_URL', scope: 'build' }],
    },
  };
  const log =
    "#14 2.1 Compiling...\n#14 3.4 Module not found: Can't resolve './header'\nDATABASE_PASSWORD=hunter2hunter2\n#14 ERROR: exit code: 1\n";

  const prisma = {
    deployment: { findUnique: () => Promise.resolve(deployment) },
    deploymentLogChunk: { findMany: () => Promise.resolve([{ content: log }]) },
    buildDiagnosis: {
      upsert: ({ create }: { create: Omit<Row, 'id' | 'status' | 'createdAt'> }) => {
        const existing = rows.find((r) => r.deploymentId === create.deploymentId);
        if (existing) return Promise.resolve(existing);
        const row: Row = {
          id: `diag-${rows.length + 1}`,
          status: 'pending',
          createdAt: new Date(),
          ...create,
        };
        rows.push(row);
        return Promise.resolve(row);
      },
      findUnique: ({ where }: { where: { id: string } }) => {
        const row = rows.find((r) => r.id === where.id);
        return Promise.resolve(row ? { ...row, deployment } : null);
      },
      count: () => Promise.resolve(rows.filter((r) => r.status === 'ready' && !r.cached).length),
      findFirst: ({ where }: { where: { fingerprint: string; id: { not: string } } }) =>
        Promise.resolve(
          rows.find(
            (r) =>
              r.status === 'ready' && r.fingerprint === where.fingerprint && r.id !== where.id.not,
          ) ?? null,
        ),
      update: ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const row = rows.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
        return Promise.resolve(row);
      },
    },
  } as unknown as PrismaService;

  const sent: string[] = [];
  const model: DiagnosisModel | null =
    options.model === undefined
      ? {
          diagnose: (message: string): Promise<ModelAnswer> => {
            sent.push(message);
            return Promise.resolve({
              diagnosis: diagnosis(),
              model: 'claude-opus-5-5',
              usage: { inputTokens: 1200, outputTokens: 300, cacheReadTokens: 0 },
            });
          },
        }
      : options.model;
  const github = {
    listDirectory: (_id: number, _repo: string, path: string) =>
      Promise.resolve(
        path === ''
          ? [
              { name: 'package.json', type: 'file' },
              { name: 'src', type: 'dir' },
              { name: 'node_modules', type: 'dir' },
            ]
          : [{ name: 'App.js', type: 'file' }],
      ),
    readFile: () => Promise.resolve('{"name":"web","scripts":{"build":"react-scripts build"}}'),
  };
  const queued: DiagnoseJobData[] = [];
  const queue = {
    add: (_name: string, data: DiagnoseJobData) => Promise.resolve(queued.push(data)),
  } as unknown as Queue<DiagnoseJobData>;
  const config = {
    get: (key: string) =>
      key === 'BUILD_DOCTOR_DAILY_LIMIT' ? (options.dailyLimit ?? 10) : undefined,
  } as unknown as AppConfigService;
  const commands: string[] = [];
  const connector = {
    connect: () =>
      Promise.resolve({
        ssh: {
          exec: (command: string) => {
            commands.push(command);
            return Promise.resolve({ code: 0, stdout: 'added\n', stderr: '' });
          },
          close: () => undefined,
        },
      }),
  } as unknown as ServerConnector;
  const retries: string[] = [];
  const launcher = {
    queueAutoRetry: (id: string) => {
      retries.push(id);
      return Promise.resolve('dep-2');
    },
  } as unknown as DeploymentLauncher;

  const service = new BuildDoctorService(
    prisma,
    config,
    connector,
    launcher,
    model,
    github as never,
    queue,
  );
  return { service, rows, sent, queued, commands, retries };
}

describe('BuildDoctorService', () => {
  it('diagnoses a failed deployment with a redacted context', async () => {
    const { service, rows, sent, queued } = setup();
    await service.requestFor('dep-1');
    expect(queued).toEqual([{ diagnosisId: 'diag-1' }]);

    await service.run('diag-1');
    expect(rows[0]).toMatchObject({ status: 'ready', model: 'claude-opus-5-5' });
    expect(rows[0]?.cached ?? false).toBe(false);
    expect(rows[0]?.result).toMatchObject({ category: 'user_code' });

    const message = sent[0] ?? '';
    expect(message).toContain("Module not found: Can't resolve './header'");
    expect(message).toContain('"build":"react-scripts build"');
    expect(message).toContain('src/App.js');
    expect(message).not.toContain('node_modules/App.js'); // listed, not expanded
    expect(message).toContain('API_URL (build)');
    expect(message).toContain('FROM node:22-alpine'); // the generated Dockerfile
    expect(message).not.toContain('hunter2');
  });

  it('reuses the diagnosis of an identical earlier failure', async () => {
    const { service, rows, sent } = setup();
    await service.requestFor('dep-1');
    await service.run('diag-1');
    rows.push({
      id: 'diag-2',
      deploymentId: 'dep-9',
      projectId: 'proj-1',
      userId: 'user-1',
      status: 'pending',
      createdAt: new Date(),
    });

    await service.run('diag-2');
    expect(sent).toHaveLength(1);
    expect(rows[1]).toMatchObject({ status: 'ready', cached: true });
  });

  it('stops at the daily limit', async () => {
    const { service, rows, sent } = setup({ dailyLimit: 0 });
    await service.requestFor('dep-1');
    await service.run('diag-1');
    expect(sent).toHaveLength(0);
    expect(rows[0]).toMatchObject({ status: 'skipped', error: expect.stringContaining('limit') });
  });

  it('records a refusal as a failed diagnosis', async () => {
    const model = {
      diagnose: () => Promise.reject(new NoDiagnosisError('The AI model declined.')),
    };
    const { service, rows } = setup({ model });
    await service.requestFor('dep-1');
    await service.run('diag-1');
    expect(rows[0]).toMatchObject({ status: 'failed', error: 'The AI model declined.' });
  });

  it('fixes server problems automatically, once', async () => {
    const oom = diagnosis({
      category: 'server_resources',
      remediation: { action: 'add_swap', value: null },
    });
    const model = {
      diagnose: () =>
        Promise.resolve({
          diagnosis: oom,
          model: 'm',
          usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
        }),
    };
    const first = setup({ model });
    await first.service.requestFor('dep-1');
    await first.service.run('diag-1');
    expect(first.commands[0]).toContain('/swapfile');
    expect(first.retries).toEqual(['dep-1']);
    expect(first.rows[0]?.autoRemediation).toBe(
      'Added 2 GB of swap. Started the deployment again.',
    );

    // The retry itself failed again: no second automatic attempt.
    const second = setup({ model, autoRetry: true });
    await second.service.requestFor('dep-1');
    await second.service.run('diag-1');
    expect(second.commands).toHaveLength(0);
    expect(second.retries).toHaveLength(0);
  });

  it('never applies settings changes automatically', async () => {
    const wrongPort = diagnosis({
      category: 'configuration',
      remediation: { action: 'set_port', value: '8080' },
    });
    const model = {
      diagnose: () =>
        Promise.resolve({
          diagnosis: wrongPort,
          model: 'm',
          usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
        }),
    };
    const { service, retries, commands, rows } = setup({ model });
    await service.requestFor('dep-1');
    await service.run('diag-1');
    expect(retries).toHaveLength(0);
    expect(commands).toHaveLength(0);
    expect(rows[0]?.autoRemediation ?? null).toBeNull();
  });

  it('does nothing without an API key', async () => {
    const { service, queued } = setup({ model: null });
    expect(service.available).toBe(false);
    await service.requestFor('dep-1');
    expect(queued).toHaveLength(0);
  });
});
