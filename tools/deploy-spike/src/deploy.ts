// Spike version, kept to reproduce docs/spike-results.md. The product engine is
// packages/remote/src/deploy.ts (AppDeployer); change that one, not this.
import { randomBytes } from 'node:crypto';
import { detectProject, getAdapter, type DetectResult } from '@selfship/adapters';
import { remoteSnapshot, type SshConnection, sh } from '@selfship/remote';

/** What to deploy and where it should be reachable. */
export interface DeployRequest {
  /** DNS-safe app name; also the Traefik router/service name. */
  app: string;
  repoUrl: string;
  ref: string;
  /** Project folder inside the repo ('' = root). */
  rootDirectory: string;
  /** Hostname routed to the app, e.g. spike.selfship.dev. */
  domain: string;
  log: (line: string) => void;
}

/** Outcome of a deployment, with timings for the spike report. */
export interface DeployResult {
  container: string;
  image: string;
  detected: DetectResult;
  timings: { cloneMs: number; buildMs: number; startMs: number; totalMs: number };
  removedContainers: string[];
}

/** Thrown when the new container doesn't become healthy; the old one stays live. */
export class HealthCheckError extends Error {
  override name = 'HealthCheckError';
}

const APPS_DIR = '/opt/selfship/apps';
const HEALTH_TIMEOUT_MS = 120_000;
/** Time for Traefik to pick up a newly healthy container before the old one stops. */
const SWITCH_SETTLE_MS = 3_000;

/**
 * Clones, detects, builds and starts a new version, then removes the old
 * one only after the new one answers HTTP: a zero-downtime switch.
 *
 * Each version has its own Traefik router; the newest has the highest
 * priority, so once it is healthy Traefik sends every request to it. The old
 * version is removed only after that, so there is no gap.
 *
 * @param ssh - Open connection to a bootstrapped server
 * @param request - What to deploy
 * @returns Result with timings
 * @throws {HealthCheckError} If the new version never answers (old version untouched)
 */
export async function deploy(ssh: SshConnection, request: DeployRequest): Promise<DeployResult> {
  const { app, log } = request;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(app)) throw new Error(`Invalid app name: ${app}`);
  if (!/^[a-z0-9.-]+$/.test(request.domain)) throw new Error(`Invalid domain: ${request.domain}`);

  const started = Date.now();
  const buildId = `${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${randomBytes(3).toString('hex')}`;
  const workDir = `${APPS_DIR}/${app}/builds/${buildId}`;
  const src = `${workDir}/src`;
  const context = request.rootDirectory ? `${src}/${request.rootDirectory}` : src;

  // 1. Clone (sparse when only a subfolder is needed, e.g. big monorepos).
  log(
    `Cloning ${request.repoUrl}@${request.ref}${request.rootDirectory ? ` (${request.rootDirectory})` : ''}`,
  );
  const cloneStart = Date.now();
  const clone = request.rootDirectory
    ? `git clone --quiet --depth 1 --filter=blob:none --sparse --branch ${sh(request.ref)} ${sh(request.repoUrl)} ${sh(src)} && git -C ${sh(src)} sparse-checkout set ${sh(request.rootDirectory)}`
    : `git clone --quiet --depth 1 --branch ${sh(request.ref)} ${sh(request.repoUrl)} ${sh(src)}`;
  await ssh.exec(`mkdir -p ${sh(workDir)} && ${clone}`, { sudo: true, timeoutMs: 10 * 60_000 });
  const commit = (
    await ssh.exec(`git -C ${sh(src)} rev-parse --short HEAD`, { sudo: true })
  ).stdout.trim();
  const cloneMs = Date.now() - cloneStart;

  // 2. Detect with the same adapters the dashboard uses.
  const detected = await detectProject(await remoteSnapshot(ssh, context));
  if (!detected) throw new Error('Could not detect the project type (add a Dockerfile)');
  log(`Detected ${detected.adapter}: ${detected.reason}`);
  const { settings } = detected;

  // 3. Write generated build files (repos with their own Dockerfile use it as-is).
  const files = getAdapter(settings.adapter).buildFiles({
    settings,
    packageManager: detected.packageManager,
    buildArgNames: [],
  });
  if (files) {
    await ssh.writeFile(`${context}/Dockerfile`, files.Dockerfile);
    await ssh.writeFile(`${context}/.dockerignore`, files['.dockerignore']);
  }

  // 4. Build.
  const image = `selfship/${app}:${commit}-${buildId.slice(-6)}`;
  log(`Building ${image}`);
  const buildStart = Date.now();
  await ssh.exec(`DOCKER_BUILDKIT=1 docker build --progress=plain -t ${sh(image)} ${sh(context)}`, {
    sudo: true,
    timeoutMs: 30 * 60_000,
    onOutput: (chunk) => {
      for (const line of chunk.split('\n')) if (line.trim()) log(`  │ ${line}`);
    },
  });
  const buildMs = Date.now() - buildStart;

  // 5. Start the new version next to the old one.
  const startStart = Date.now();
  const container = `${app}-${buildId}`;
  const port = String(settings.port);
  // Each deployment gets its OWN router and service (named after the build),
  // so two versions never define the same router differently: Traefik drops
  // conflicting routers entirely (404s during the overlap). The newest
  // deployment gets the highest priority, so Traefik moves all traffic to it
  // the moment it is healthy; the old one then receives nothing and can stop.
  const route = `${app}-${buildId}`;
  const priority = String(Math.floor(Date.now() / 1000) - 1_700_000_000);
  const labels = [
    'traefik.enable=true',
    `traefik.http.routers.${route}.rule=Host(\`${request.domain}\`)`,
    `traefik.http.routers.${route}.priority=${priority}`,
    `traefik.http.routers.${route}.entrypoints=websecure`,
    `traefik.http.routers.${route}.tls.certresolver=le`,
    `traefik.http.routers.${route}.service=${route}`,
    // Retry on another server if a connection is refused mid-switch.
    `traefik.http.routers.${route}.middlewares=${route}-retry`,
    `traefik.http.middlewares.${route}-retry.retry.attempts=3`,
    `traefik.http.middlewares.${route}-retry.retry.initialinterval=100ms`,
    `traefik.http.services.${route}.loadbalancer.server.port=${port}`,
    `selfship.app=${app}`,
    `selfship.build=${buildId}`,
  ];
  // Traefik only routes to containers whose Docker health check passes, so a
  // new version gets no traffic until it is actually listening. Our generated
  // images (Alpine-based) have busybox `nc`; custom Dockerfiles keep their own
  // HEALTHCHECK, if any.
  const healthCheck = files
    ? [
        `--health-cmd ${sh(`nc -z 127.0.0.1 ${port} || exit 1`)}`,
        '--health-interval 2s',
        '--health-timeout 2s',
        '--health-retries 3',
        '--health-start-period 120s',
      ]
    : [];
  await ssh.exec(
    [
      'docker run -d',
      `--name ${sh(container)}`,
      '--network selfship',
      '--restart unless-stopped',
      `-e PORT=${sh(port)}`,
      ...healthCheck,
      ...labels.map((label) => `--label ${sh(label)}`),
      sh(image),
    ].join(' '),
    { sudo: true },
  );

  // 6. Health check from the server, straight to the container (not via Traefik).
  log(`Waiting for ${container} to answer on port ${port}`);
  const healthy = await waitHealthy(ssh, container, port);
  if (!healthy) {
    const logs = await ssh.exec(`docker logs --tail 40 ${sh(container)} 2>&1`, {
      sudo: true,
      check: false,
    });
    await ssh.exec(`docker rm -f ${sh(container)}`, { sudo: true, check: false });
    throw new HealthCheckError(
      `New version didn't answer within ${HEALTH_TIMEOUT_MS / 1000}s; previous version kept.\n${logs.stdout}`,
    );
  }
  const startMs = Date.now() - startStart;

  // 7. Switch: give Traefik a moment to start routing to the new (healthy)
  //    version, then remove previous versions.
  await new Promise((resolve) => setTimeout(resolve, SWITCH_SETTLE_MS));
  const old = (
    await ssh.exec(`docker ps -a --filter label=selfship.app=${sh(app)} --format '{{.Names}}'`, {
      sudo: true,
    })
  ).stdout
    .split('\n')
    .map((name) => name.trim())
    .filter((name) => name && name !== container);
  for (const name of old) {
    await ssh.exec(`docker stop -t 10 ${sh(name)} >/dev/null && docker rm ${sh(name)} >/dev/null`, {
      sudo: true,
      check: false,
    });
  }
  if (old.length) log(`Removed previous version(s): ${old.join(', ')}`);

  // 8. Housekeeping: keep the last 3 images and builds for rollback.
  await ssh.exec(
    `docker images ${sh(`selfship/${app}`)} --format '{{.Repository}}:{{.Tag}}' | tail -n +4 | xargs -r docker rmi >/dev/null 2>&1 || true; ` +
      `ls -1dt ${sh(`${APPS_DIR}/${app}/builds`)}/* | tail -n +4 | xargs -r rm -rf`,
    { sudo: true, check: false },
  );

  return {
    container,
    image,
    detected,
    timings: { cloneMs, buildMs, startMs, totalMs: Date.now() - started },
    removedContainers: old,
  };
}

/** Polls the container over the Docker network until it answers (< 500) or times out. */
async function waitHealthy(ssh: SshConnection, container: string, port: string): Promise<boolean> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const state = await ssh.exec(
      `docker inspect -f '{{.State.Running}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' ${sh(container)}`,
      { sudo: true, check: false },
    );
    const [running, health] = state.stdout.trim().split(' ');
    if (running !== 'true') return false; // crashed
    // With a Docker health check, wait until Docker (and therefore Traefik) sees it healthy.
    if (health !== 'none' && health !== 'healthy') {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    const probe = await ssh.exec(
      `ip=$(docker inspect -f '{{(index .NetworkSettings.Networks "selfship").IPAddress}}' ${sh(container)}); curl -s -o /dev/null -m 5 -w '%{http_code}' "http://$ip:${port}/"`,
      { sudo: true, check: false },
    );
    const code = Number(probe.stdout.trim());
    if (code > 0 && code < 500) return true;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return false;
}
