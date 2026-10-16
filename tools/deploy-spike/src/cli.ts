// Deploy spike CLI. Usage:
//   pnpm spike check     --host 1.2.3.4
//   pnpm spike bootstrap --host 1.2.3.4 [--acme-email you@x.com] [--staging]
//   pnpm spike deploy    --host 1.2.3.4 --repo https://github.com/o/r --domain app.example.com
//                        [--ref main] [--root-dir examples/x] [--app name] [--probe]
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { deploy } from './deploy.ts';
import { sampleMemory } from './memory-sampler.ts';
import { preflight } from './preflight.ts';
import { readPrivateKey, sh, SshConnection } from './ssh.ts';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    host: { type: 'string' },
    port: { type: 'string', default: '22' },
    user: { type: 'string', default: 'ubuntu' },
    key: { type: 'string', default: '~/.ssh/id_rsa' },
    fingerprint: { type: 'string' },
    repo: { type: 'string' },
    ref: { type: 'string', default: 'main' },
    'root-dir': { type: 'string', default: '' },
    domain: { type: 'string' },
    app: { type: 'string' },
    'acme-email': { type: 'string', default: '' },
    staging: { type: 'boolean', default: false },
    probe: { type: 'boolean', default: false },
  },
});

const command = positionals[0];
const started = Date.now();
const elapsed = (): string => `${((Date.now() - started) / 1000).toFixed(1)}s`;
const log = (line: string): void => {
  process.stdout.write(`[${elapsed().padStart(6)}] ${line}\n`);
};

/** Fails with a usage hint when a required option is missing. */
function required(name: keyof typeof values): string {
  const value = values[name];
  if (typeof value !== 'string' || !value) {
    process.stderr.write(`Missing --${name}. See the usage comment at the top of src/cli.ts.\n`);
    process.exit(2);
  }
  return value;
}

/**
 * Requests the site continuously (through Traefik, with --resolve so DNS
 * isn't needed) and counts failures, to prove a redeploy has no downtime.
 */
function startProbe(
  host: string,
  domain: string,
): { stop: () => { ok: number; failed: number; codes: Record<string, number> } } {
  const stats = { ok: 0, failed: 0, codes: {} as Record<string, number> };
  let running = true;
  const loop = async (): Promise<void> => {
    while (running) {
      const code = await new Promise<string>((resolve) => {
        const curl = spawn('curl', [
          '-sk',
          '-o',
          '/dev/null',
          '-m',
          '5',
          '-w',
          '%{http_code}',
          '--resolve',
          `${domain}:443:${host}`,
          `https://${domain}/`,
        ]);
        let out = '';
        curl.stdout.on('data', (data: Buffer) => {
          out += data.toString();
        });
        curl.on('close', () => {
          resolve(out || '000');
        });
      });
      stats.codes[code] = (stats.codes[code] ?? 0) + 1;
      if (code.startsWith('2') || code.startsWith('3')) stats.ok++;
      else stats.failed++;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };
  void loop();
  return {
    stop: () => {
      running = false;
      return stats;
    },
  };
}

async function main(): Promise<void> {
  if (!command || !['check', 'bootstrap', 'deploy'].includes(command)) {
    process.stderr.write(
      'Usage: pnpm spike <check|bootstrap|deploy> --host <ip> [options] (see src/cli.ts)\n',
    );
    process.exit(2);
  }
  const host = required('host');
  const ssh = await SshConnection.connect({
    host,
    port: Number(values.port),
    username: values.user,
    privateKey: readPrivateKey(values.key),
    ...(values.fingerprint ? { expectedFingerprint: values.fingerprint } : {}),
  });
  log(`Connected to ${host} (host key ${ssh.fingerprint})`);

  try {
    const report = await preflight(ssh);
    log(
      `Server: ${report.os}, ${report.arch}, ${report.cpus} CPU, ${report.ramMb} MB RAM, ${report.swapMb} MB swap, ${report.diskFreeGb} GB free, Docker ${report.dockerVersion ?? 'not installed'}`,
    );
    for (const warning of report.warnings) log(`⚠ ${warning}`);
    for (const problem of report.problems) log(`✗ ${problem}`);
    if (command === 'check') return;
    if (report.problems.length) throw new Error('Pre-flight failed; fix the problems above first');

    if (command === 'bootstrap') {
      const script = readFileSync(path.join(import.meta.dirname, 'bootstrap.sh'), 'utf8');
      const env = `SSH_PORT=${Number(values.port)} ACME_EMAIL=${sh(values['acme-email'])} ACME_STAGING=${values.staging ? 1 : 0}`;
      await ssh.exec(`${env} bash -s`, {
        sudo: true,
        stdin: script,
        timeoutMs: 15 * 60_000,
        onOutput: (chunk) => {
          for (const line of chunk.split('\n')) if (line.trim()) log(line);
        },
      });
      const idle = await ssh.exec("free -m | awk '/Mem:/{print $3}'", { check: false });
      log(`Bootstrap done. RAM in use at idle (Docker + Traefik): ${idle.stdout.trim()} MB`);
      return;
    }

    const domain = required('domain');
    const repoUrl = required('repo');
    const app =
      values.app ??
      path
        .basename(values['root-dir'] || repoUrl)
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    const memory = sampleMemory(ssh);
    const probe = values.probe ? startProbe(host, domain) : null;
    try {
      const result = await deploy(ssh, {
        app,
        repoUrl,
        ref: values.ref,
        rootDirectory: values['root-dir'],
        domain,
        log,
      });
      const peak = await memory.stop();
      const t = result.timings;
      log(`✓ Live: ${result.container} (${result.detected.adapter}) at https://${domain}`);
      log(
        `  clone ${(t.cloneMs / 1000).toFixed(1)}s · build ${(t.buildMs / 1000).toFixed(1)}s · start ${(t.startMs / 1000).toFixed(1)}s · total ${(t.totalMs / 1000).toFixed(1)}s`,
      );
      log(`  peak RAM in use ${peak.ramUsedMb} MB · peak swap ${peak.swapUsedMb} MB`);
      if (probe) {
        await new Promise((resolve) => setTimeout(resolve, 3000)); // keep probing after the switch
        const stats = probe.stop();
        log(
          `  probe during redeploy: ${stats.ok} ok, ${stats.failed} failed ${JSON.stringify(stats.codes)}`,
        );
      }
    } finally {
      probe?.stop();
      await memory.stop().catch(() => undefined);
    }
  } finally {
    ssh.close();
  }
}

main().catch((error: unknown) => {
  log(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
