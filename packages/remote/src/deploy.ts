import { getAdapter, packageManagerOf } from '@selfship/adapters';
import type { DeploymentStage, ProjectSettings } from '@selfship/shared';
import { remoteSnapshot } from './remote-snapshot';
import { type CommandRunner, RemoteCommandError, sh } from './ssh';

/** Build a commit from GitHub. */
export interface GitSource {
  kind: 'git';
  /** HTTPS clone URL without credentials. */
  cloneUrl: string;
  /** Full commit SHA to deploy. */
  sha: string;
  /** Project folder inside the repository ('' = root). */
  rootDirectory: string;
  /** Short-lived GitHub installation token, sent over stdin only. */
  token: string;
}

/** Run an image an earlier deployment built (rollback): no clone, no build. */
export interface ImageSource {
  kind: 'image';
  /** Image tag of the earlier deployment, e.g. `selfship/p-…:abc1234-123456`. */
  imageTag: string;
}

/** Which hostnames reach the app. */
export interface Routing {
  /** Served by the app (at least one). */
  hosts: string[];
  /** Answered with a permanent redirect to another hostname (e.g. www → apex). */
  redirects: { from: string; to: string }[];
}

/** Everything needed to deploy one commit. Built by the worker from the database. */
export interface DeployPlan {
  /** DNS-safe app ID, stable per project (container/Traefik names, server folder). */
  app: string;
  /** Deployment ID (labels, build folder). */
  deploymentId: string;
  /** What to deploy. */
  source: GitSource | ImageSource;
  settings: ProjectSettings;
  /** Hostnames Traefik routes to the app, and redirects between them. */
  routing: Routing;
  /** Path checked before traffic moves (any status < 500 passes). */
  healthCheckPath: string;
  /** Variables by when they're needed. A `both` variable appears in each. */
  env: { build: Record<string, string>; runtime: Record<string, string> };
  /**
   * Free sandbox (shared platform server): resource limits, no extra
   * privileges, its own Docker network, a request rate limit, and no
   * outbound mail. Omitted on users' own servers.
   */
  sandbox?: { memory: string; cpus: string; pids: number };
}

/** Callbacks into the worker. */
export interface DeployHooks {
  /** One line of output (the worker masks secrets before storing it). */
  log(line: string): void;
  /** A new stage starts. */
  stage(stage: DeploymentStage): Promise<void>;
}

/** Result of a successful deployment. */
export interface DeployOutcome {
  imageTag: string;
  containerName: string;
  /** Containers of earlier deployments that were stopped. */
  replacedContainers: string[];
}

/** The deployment failed in a known stage; the previous version keeps serving. */
export class DeployError extends Error {
  override name = 'DeployError';

  /**
   * @param stage - Stage that failed
   * @param message - What went wrong, for users
   */
  constructor(
    readonly stage: DeploymentStage,
    message: string,
  ) {
    super(message);
  }
}

/** The user cancelled; the previous version keeps serving. */
export class DeployCancelledError extends Error {
  override name = 'DeployCancelledError';
  constructor() {
    super('Deployment cancelled.');
  }
}

/** Timings, overridable in tests. */
export interface DeployTimings {
  /** How long a new version has to answer before we give up. Default 120 s. */
  healthTimeoutMs: number;
  /** Pause between health probes. Default 2 s. */
  healthPollMs: number;
  /** Time for Traefik to start routing to the new version before old ones stop. Default 3 s. */
  switchSettleMs: number;
}

const DEFAULT_TIMINGS: DeployTimings = {
  healthTimeoutMs: 120_000,
  healthPollMs: 2_000,
  switchSettleMs: 3_000,
};

/** Root of everything Selfship keeps on a server. */
export const APPS_DIR = '/opt/selfship/apps';
/** Images kept per app for rollback (including the live one). */
const KEEP_IMAGES = 3;
/** Above this disk usage (%), the Docker build cache is pruned after a deployment. */
const PRUNE_DISK_PERCENT = 80;
const CLONE_TIMEOUT_MS = 10 * 60_000;
const BUILD_TIMEOUT_MS = 30 * 60_000;
/** Builds on shared sandbox servers must be quick. */
const SANDBOX_BUILD_TIMEOUT_MS = 10 * 60_000;

const APP_ID = /^[a-z0-9]([a-z0-9-]{0,40}[a-z0-9])?$/;
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Deploys one commit to a prepared server with a zero-downtime switch:
 *
 * 1. **cloning**: fetch exactly the commit, authenticated with a token sent over stdin
 * 2. **building**: write generated build files (unless the repo has its own Dockerfile), `docker build`
 * 3. **starting**: run the new container next to the old one
 * 4. **health_check**: wait until it answers HTTP
 * 5. **switching**: the new container's Traefik router has a higher priority,
 *    so traffic moves as soon as it's healthy; then the old containers stop
 *
 * Any failure before the switch removes the new container and leaves the old
 * one serving. Long steps run in their own process group on the server, so
 * {@link AppDeployer.cancel} can stop them.
 */
export class AppDeployer {
  private readonly buildId: string;
  private readonly buildDir: string;
  private readonly srcDir: string;
  private readonly contextDir: string;
  private readonly pidFile: string;
  private cancelled = false;
  /** Cancelling is refused once traffic starts moving. */
  private cancellable = true;

  /**
   * @param runner - Open connection to a ready server
   * @param plan - What to deploy
   * @param hooks - Logging and stage callbacks
   * @param timings - Overrides for waits (tests)
   * @throws {Error} If the plan contains values unsafe to use in names or rules
   */
  constructor(
    private readonly runner: CommandRunner,
    private readonly plan: DeployPlan,
    private readonly hooks: DeployHooks,
    private readonly timings: DeployTimings = DEFAULT_TIMINGS,
  ) {
    if (!APP_ID.test(plan.app)) throw new Error(`Invalid app ID: ${plan.app}`);
    const { hosts, redirects } = plan.routing;
    if (hosts.length === 0) throw new Error('At least one host is required');
    for (const host of [...hosts, ...redirects.flatMap((r) => [r.from, r.to])]) {
      if (!HOST.test(host)) throw new Error(`Invalid host: ${host}`);
    }
    if (plan.source.kind === 'git' && !/^[0-9a-f]{40}$/.test(plan.source.sha)) {
      throw new Error('Invalid commit SHA');
    }
    if (plan.source.kind === 'image' && !plan.source.imageTag.startsWith(`selfship/${plan.app}:`)) {
      throw new Error("Can only roll back to this app's own images");
    }
    for (const key of [...Object.keys(plan.env.build), ...Object.keys(plan.env.runtime)]) {
      if (!ENV_KEY.test(key)) throw new Error(`Invalid variable name: ${key}`);
    }
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    this.buildId = `${stamp}-${plan.deploymentId.replace(/-/g, '').slice(0, 6)}`;
    this.buildDir = `${APPS_DIR}/${plan.app}/builds/${this.buildId}`;
    this.srcDir = `${this.buildDir}/src`;
    const rootDirectory = plan.source.kind === 'git' ? plan.source.rootDirectory : '';
    this.contextDir = rootDirectory ? `${this.srcDir}/${rootDirectory}` : this.srcDir;
    this.pidFile = `${this.buildDir}/pid`;
  }

  /** Docker network of the app: shared on users' servers, its own on the sandbox. */
  private get network(): string {
    return this.plan.sandbox ? `sbx-${this.plan.app}` : 'selfship';
  }

  /** Name of the new container (also its Traefik router and service). */
  get containerName(): string {
    return `${this.plan.app}-${this.buildId}`;
  }

  /**
   * Runs the whole pipeline.
   *
   * @returns Image, container and what was replaced
   * @throws {DeployError} With the failed stage (previous version still serving)
   * @throws {DeployCancelledError} If cancelled (previous version still serving)
   */
  async run(): Promise<DeployOutcome> {
    let containerStarted = false;
    let stage: DeploymentStage = 'cloning';
    const { source } = this.plan;
    try {
      let imageTag: string;
      if (source.kind === 'git') {
        await this.enter((stage = 'cloning'));
        await this.clone(source);

        await this.enter((stage = 'building'));
        imageTag = await this.build(source);
      } else {
        imageTag = source.imageTag;
      }

      await this.enter((stage = 'starting'));
      if (source.kind === 'image') await this.assertImageExists(imageTag);
      await this.start(imageTag);
      containerStarted = true;

      await this.enter((stage = 'health_check'));
      await this.waitHealthy();

      this.cancellable = false;
      await this.enter((stage = 'switching'));
      const replacedContainers = await this.switchTraffic();
      await this.cleanup();
      return { imageTag, containerName: this.containerName, replacedContainers };
    } catch (error) {
      if (containerStarted) await this.removeNewContainer();
      await this.removeSources();
      if (this.cancelled) throw new DeployCancelledError();
      if (error instanceof DeployError) throw error;
      throw new DeployError(stage, describeFailure(stage, error));
    }
  }

  /**
   * Stops the running step on the server. Has no effect once traffic is switching.
   *
   * @returns True if the deployment will stop
   */
  async cancel(): Promise<boolean> {
    if (!this.cancellable) return false;
    this.cancelled = true;
    // Kill the step's whole process group (git, docker build and their children).
    await this.runner.exec(
      `[ -f ${sh(this.pidFile)} ] && kill -TERM -- -"$(cat ${sh(this.pidFile)})" 2>/dev/null || true`,
      { sudo: true, check: false, timeoutMs: 15_000 },
    );
    return true;
  }

  /** Starts a stage, unless the user already cancelled. */
  private async enter(stage: DeploymentStage): Promise<void> {
    if (this.cancelled) throw new DeployCancelledError();
    await this.hooks.stage(stage);
  }

  /**
   * Fetches exactly one commit. The token arrives on stdin and only lives in
   * git's environment (readable by root only): it's never in a command line
   * (`ps`), a file, or `.git/config`.
   */
  private async clone(source: GitSource): Promise<void> {
    const { cloneUrl, sha, rootDirectory } = source;
    this.hooks.log(`→ Fetching ${sha.slice(0, 7)}${rootDirectory ? ` (${rootDirectory}/)` : ''}`);
    const sparse = rootDirectory
      ? `git sparse-checkout init --cone && git sparse-checkout set ${sh(rootDirectory)}`
      : 'true';
    await this.step(
      [
        'read -r GH_TOKEN',
        `rm -rf ${sh(this.srcDir)} && mkdir -p ${sh(this.srcDir)} && cd ${sh(this.srcDir)}`,
        'git init -q',
        `git remote add origin ${sh(cloneUrl)}`,
        sparse,
        `auth=$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)`,
        'unset GH_TOKEN',
        `GIT_TERMINAL_PROMPT=0 GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.extraHeader GIT_CONFIG_VALUE_0="Authorization: Basic $auth" ` +
          `git fetch -q --depth 1 ${rootDirectory ? '--filter=blob:none ' : ''}origin ${sh(sha)}`,
        'git -c advice.detachedHead=false checkout -q FETCH_HEAD',
        rootDirectory
          ? `[ -d ${sh(this.contextDir)} ] || { echo "Folder ${rootDirectory} not found in this commit" >&2; exit 3; }`
          : 'true',
      ].join('\n'),
      { stdin: `${source.token}\n`, timeoutMs: CLONE_TIMEOUT_MS },
    );
    this.hooks.log('✓ Source fetched');
  }

  /**
   * Builds the image. Build-time variables are exported from a root-only
   * file and passed with `--build-arg NAME` (no value on the command line).
   *
   * @param source - The commit being built
   * @returns Image tag
   */
  private async build(source: GitSource): Promise<string> {
    const { settings } = this.plan;
    const buildArgNames = Object.keys(this.plan.env.build);
    const files = getAdapter(settings.adapter).buildFiles({
      settings,
      packageManager:
        settings.adapter === 'dockerfile' || settings.adapter === 'static'
          ? null
          : await packageManagerOf(await remoteSnapshot(this.runner, this.contextDir)),
      buildArgNames,
    });
    if (files) {
      await this.writeFile(`${this.contextDir}/Dockerfile`, files.Dockerfile, '644');
      await this.writeFile(`${this.contextDir}/.dockerignore`, files['.dockerignore'], '644');
      this.hooks.log(`→ Using a generated Dockerfile (${settings.adapter})`);
    } else {
      this.hooks.log("→ Using the repository's Dockerfile");
    }

    const imageTag = `selfship/${this.plan.app}:${source.sha.slice(0, 7)}-${this.buildId.slice(-6)}`;
    const envFile = `${this.buildDir}/build-env.sh`;
    await this.writeFile(envFile, exportLines(this.plan.env.build), '600');
    if (buildArgNames.length > 0) {
      this.hooks.log(`→ Build variables: ${buildArgNames.join(', ')}`);
    }
    this.hooks.log(`→ Building ${imageTag}`);
    await this.step(
      [
        `trap ${sh(`rm -f ${sh(envFile)}`)} EXIT`,
        `. ${sh(envFile)}`,
        [
          'DOCKER_BUILDKIT=1 docker build --progress=plain',
          ...buildArgNames.map((name) => `--build-arg ${name}`),
          `--label ${sh(`selfship.app=${this.plan.app}`)}`,
          `-t ${sh(imageTag)}`,
          sh(this.contextDir),
        ].join(' '),
      ].join('\n'),
      { timeoutMs: this.plan.sandbox ? SANDBOX_BUILD_TIMEOUT_MS : BUILD_TIMEOUT_MS, stream: true },
    );
    await this.removeSources();
    this.hooks.log('✓ Image built');
    return imageTag;
  }

  /**
   * Checks a rollback's image is still on the server (only the newest few are kept).
   *
   * @throws {DeployError} If it was cleaned up
   */
  private async assertImageExists(imageTag: string): Promise<void> {
    this.hooks.log(`→ Using the existing image ${imageTag} (no rebuild)`);
    const { code } = await this.runner.exec(
      `docker image inspect ${sh(imageTag)} >/dev/null 2>&1`,
      {
        sudo: true,
        check: false,
      },
    );
    if (code !== 0) {
      throw new DeployError(
        'starting',
        `The image of that deployment is no longer on the server (only the last ${KEEP_IMAGES} are kept). Redeploy its commit instead.`,
      );
    }
  }

  /**
   * Starts the new container next to the current one. Runtime variables are
   * exported from a root-only file and passed with `-e NAME`, which keeps
   * multiline values intact (Docker's `--env-file` can't).
   */
  private async start(imageTag: string): Promise<void> {
    const { app } = this.plan;
    const route = this.containerName;
    const port = String(this.plan.settings.port);
    const runtimeNames = Object.keys(this.plan.env.runtime);
    // Each deployment has its own router; the newest gets the highest
    // priority, so Traefik moves all traffic once it's healthy. Shared router
    // names with differing labels make Traefik drop the route (404s).
    const priority = String(Math.floor(Date.now() / 1000) - 1_700_000_000);
    const rule = (names: string[]): string => names.map((name) => `Host(\`${name}\`)`).join(' || ');
    const labels = [
      'traefik.enable=true',
      `traefik.http.routers.${route}.rule=${rule(this.plan.routing.hosts)}`,
      `traefik.http.routers.${route}.priority=${priority}`,
      `traefik.http.routers.${route}.entrypoints=websecure`,
      `traefik.http.routers.${route}.tls.certresolver=le`,
      `traefik.http.routers.${route}.service=${route}`,
      `traefik.http.routers.${route}.middlewares=${route}-retry${this.plan.sandbox ? `,${route}-ratelimit` : ''}`,
      `traefik.http.middlewares.${route}-retry.retry.attempts=3`,
      `traefik.http.middlewares.${route}-retry.retry.initialinterval=100ms`,
      `traefik.http.services.${route}.loadbalancer.server.port=${port}`,
      `selfship.app=${app}`,
      `selfship.deployment=${this.plan.deploymentId}`,
      ...(this.plan.sandbox
        ? [
            `traefik.docker.network=${this.network}`,
            `traefik.http.middlewares.${route}-ratelimit.ratelimit.average=50`,
            `traefik.http.middlewares.${route}-ratelimit.ratelimit.burst=100`,
          ]
        : []),
      // Redirect hostnames get their own router that only redirects (with its own certificate).
      ...this.plan.routing.redirects.flatMap(({ from, to }, index) => {
        const name = `${route}-redirect${index}`;
        return [
          `traefik.http.routers.${name}.rule=${rule([from])}`,
          `traefik.http.routers.${name}.priority=${priority}`,
          `traefik.http.routers.${name}.entrypoints=websecure`,
          `traefik.http.routers.${name}.tls.certresolver=le`,
          `traefik.http.routers.${name}.service=${route}`,
          `traefik.http.routers.${name}.middlewares=${name}`,
          `traefik.http.middlewares.${name}.redirectregex.regex=^https?://[^/]+(.*)`,
          `traefik.http.middlewares.${name}.redirectregex.replacement=https://${to}\${1}`,
          `traefik.http.middlewares.${name}.redirectregex.permanent=true`,
        ];
      }),
    ];
    // Traefik only routes to containers whose Docker health check passes.
    // Generated images are Alpine-based (busybox nc); custom Dockerfiles keep
    // their own HEALTHCHECK, if any.
    const generated = this.plan.settings.adapter !== 'dockerfile';
    const healthCheck = generated
      ? [
          `--health-cmd ${sh(`nc -z 127.0.0.1 ${port} || exit 1`)}`,
          '--health-interval 2s',
          '--health-timeout 2s',
          '--health-retries 3',
          '--health-start-period 120s',
        ]
      : [];
    const sandbox = this.plan.sandbox
      ? [
          `--memory ${sh(this.plan.sandbox.memory)}`,
          `--memory-swap ${sh(this.plan.sandbox.memory)}`,
          `--cpus ${sh(this.plan.sandbox.cpus)}`,
          `--pids-limit ${this.plan.sandbox.pids}`,
          '--security-opt no-new-privileges',
          // Only what nginx/node need to bind their port and drop to their own user.
          '--cap-drop ALL',
          ...['CHOWN', 'SETUID', 'SETGID', 'NET_BIND_SERVICE', 'DAC_OVERRIDE'].map(
            (c) => `--cap-add ${c}`,
          ),
        ]
      : [];
    if (this.plan.sandbox) await this.isolate();
    const envFile = `${this.buildDir}/run-env.sh`;
    await this.writeFile(envFile, exportLines(this.plan.env.runtime), '600');
    this.hooks.log(`→ Starting ${route}`);
    await this.step(
      [
        `trap ${sh(`rm -f ${sh(envFile)}`)} EXIT`,
        `. ${sh(envFile)}`,
        [
          'docker run -d',
          `--name ${sh(route)}`,
          `--network ${sh(this.network)}`,
          '--restart unless-stopped',
          ...sandbox,
          `-e PORT=${sh(port)}`,
          ...runtimeNames.map((name) => `-e ${name}`),
          ...healthCheck,
          ...labels.map((label) => `--label ${sh(label)}`),
          sh(imageTag),
          '>/dev/null',
        ].join(' '),
      ].join('\n'),
      { timeoutMs: 5 * 60_000 },
    );
  }

  /**
   * Sandbox only: gives the app its own Docker network (apps can't reach each
   * other; Traefik is connected to each), and blocks outbound mail ports
   * (spam). Both are idempotent and re-applied on every deployment.
   */
  private async isolate(): Promise<void> {
    const network = sh(this.network);
    await this.runner.exec(
      [
        `docker network inspect ${network} >/dev/null 2>&1 || docker network create ${network} >/dev/null`,
        `docker network connect ${network} selfship-traefik 2>/dev/null || true`,
        'for port in 25 465 587; do',
        '  iptables -C DOCKER-USER -p tcp --dport "$port" -j REJECT 2>/dev/null || iptables -I DOCKER-USER -p tcp --dport "$port" -j REJECT',
        'done',
      ].join('\n'),
      { sudo: true, timeoutMs: 60_000 },
    );
  }

  /**
   * Waits until the new container answers HTTP on the health check path,
   * probing it directly over the Docker network (not through Traefik).
   *
   * @throws {DeployError} If it crashes or doesn't answer in time (with its last log lines)
   */
  private async waitHealthy(): Promise<void> {
    const container = sh(this.containerName);
    const port = this.plan.settings.port;
    const path = this.plan.healthCheckPath;
    this.hooks.log(`→ Waiting for the app to answer on port ${port} (${path})`);
    const deadline = Date.now() + this.timings.healthTimeoutMs;
    let lastCode = 0;
    while (Date.now() < deadline) {
      if (this.cancelled) throw new DeployCancelledError();
      const state = await this.runner.exec(
        `docker inspect -f '{{.State.Running}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{.RestartCount}}' ${container}`,
        { sudo: true, check: false },
      );
      const [running, health, restarts] = state.stdout.trim().split(' ');
      if (running !== 'true' || Number(restarts) > 0) {
        throw new DeployError(
          'health_check',
          `The app exited right after starting.${await this.containerLogs()}`,
        );
      }
      if (health === 'none' || health === 'healthy') {
        const probe = await this.runner.exec(
          `ip=$(docker inspect -f '{{(index .NetworkSettings.Networks "${this.network}").IPAddress}}' ${container}); ` +
            `curl -s -o /dev/null -m 5 -w '%{http_code}' "http://$ip:${port}"${sh(path)}`,
          { sudo: true, check: false },
        );
        lastCode = Number(probe.stdout.trim()) || 0;
        if (lastCode > 0 && lastCode < 500) {
          this.hooks.log(`✓ App answered with HTTP ${lastCode}`);
          return;
        }
      }
      await sleep(this.timings.healthPollMs);
    }
    throw new DeployError(
      'health_check',
      `The app didn't answer on port ${port} within ${this.timings.healthTimeoutMs / 1000}s` +
        `${lastCode ? ` (last response: HTTP ${lastCode})` : ''}. Check that it listens on 0.0.0.0:${port} (the PORT variable).` +
        (await this.containerLogs()),
    );
  }

  /**
   * Gives Traefik a moment to route to the new version, then stops the
   * others.
   *
   * @returns Names of the containers that were stopped
   */
  private async switchTraffic(): Promise<string[]> {
    await sleep(this.timings.switchSettleMs);
    const { stdout } = await this.runner.exec(
      `docker ps -a --filter ${sh(`label=selfship.app=${this.plan.app}`)} --format '{{.Names}}'`,
      { sudo: true },
    );
    const old = stdout
      .split('\n')
      .map((name) => name.trim())
      .filter((name) => name && name !== this.containerName);
    for (const name of old) {
      await this.runner.exec(
        `docker stop -t 10 ${sh(name)} >/dev/null && docker rm ${sh(name)} >/dev/null`,
        { sudo: true, check: false },
      );
    }
    this.hooks.log(
      old.length ? `✓ Traffic switched; stopped ${old.join(', ')}` : '✓ Traffic routed to the app',
    );
    return old;
  }

  /** Keeps the newest images and build folders; prunes the build cache when the disk fills up. */
  private async cleanup(): Promise<void> {
    const app = this.plan.app;
    await this.runner.exec(
      [
        `docker images ${sh(`selfship/${app}`)} --format '{{.Repository}}:{{.Tag}}' | tail -n +${KEEP_IMAGES + 1} | xargs -r docker rmi >/dev/null 2>&1 || true`,
        `ls -1dt ${sh(`${APPS_DIR}/${app}/builds`)}/* 2>/dev/null | tail -n +${KEEP_IMAGES + 1} | xargs -r rm -rf`,
      ].join('\n'),
      { sudo: true, check: false },
    );
    const { stdout } = await this.runner.exec(`df -P / | awk 'NR==2{print int($5)}'`, {
      check: false,
    });
    if (Number(stdout.trim()) >= PRUNE_DISK_PERCENT) {
      this.hooks.log(`→ Disk is ${stdout.trim()}% full: clearing the Docker build cache`);
      await this.runner.exec(
        'docker builder prune -af >/dev/null; docker image prune -f >/dev/null',
        {
          sudo: true,
          check: false,
          timeoutMs: 10 * 60_000,
        },
      );
    }
  }

  /** Runs a script as root in its own process group (so cancel can kill it). */
  private async step(
    script: string,
    options: { stdin?: string; timeoutMs: number; stream?: boolean },
  ): Promise<void> {
    const body = `echo $$ > ${sh(this.pidFile)}\nset -euo pipefail\n${script}`;
    const lines = options.stream
      ? new LineSplitter((line) => {
          this.hooks.log(line);
        })
      : null;
    try {
      await this.runner.exec(`mkdir -p ${sh(this.buildDir)} && setsid --wait bash -c ${sh(body)}`, {
        sudo: true,
        timeoutMs: options.timeoutMs,
        ...(options.stdin !== undefined ? { stdin: options.stdin } : {}),
        ...(lines
          ? {
              onOutput: (chunk: string) => {
                lines.push(chunk);
              },
            }
          : {}),
      });
    } finally {
      lines?.flush();
    }
  }

  /** Writes a file as root through stdin. */
  private async writeFile(path: string, content: string, mode: string): Promise<void> {
    await this.runner.exec(`install -D -m ${sh(mode)} /dev/stdin ${sh(path)}`, {
      sudo: true,
      stdin: content,
    });
  }

  /** Last lines of the new container's output, formatted for an error message. */
  private async containerLogs(): Promise<string> {
    const { stdout } = await this.runner.exec(
      `docker logs --tail 30 ${sh(this.containerName)} 2>&1`,
      { sudo: true, check: false },
    );
    const text = stdout.trim();
    return text ? `\n\nLast output of the app:\n${text}` : '';
  }

  private async removeNewContainer(): Promise<void> {
    await this.runner.exec(`docker rm -f ${sh(this.containerName)} >/dev/null 2>&1 || true`, {
      sudo: true,
      check: false,
    });
  }

  /** Deletes the clone and any env files (they must not stay on disk). */
  private async removeSources(): Promise<void> {
    await this.runner.exec(
      `rm -rf ${sh(this.srcDir)} ${sh(`${this.buildDir}/build-env.sh`)} ${sh(`${this.buildDir}/run-env.sh`)}`,
      { sudo: true, check: false },
    );
  }
}

/**
 * Renders `export NAME='value'` lines. Values are single-quoted, so nothing
 * in them is interpreted by the shell that sources the file.
 *
 * @param vars - Variables
 * @returns Shell script
 */
export function exportLines(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([key, value]) => `export ${key}=${sh(value)}\n`)
    .join('');
}

/** A short user-facing reason for a failed stage. */
function describeFailure(stage: DeploymentStage, error: unknown): string {
  const output = error instanceof RemoteCommandError ? error.output.trim() : '';
  const tail = output ? `\n${output.split('\n').slice(-15).join('\n')}` : '';
  switch (stage) {
    case 'cloning':
      return /not found in this commit/.test(output)
        ? `The project folder doesn't exist in this commit.${tail}`
        : `Couldn't fetch the code from GitHub.${tail}`;
    case 'building':
      return 'The build failed. See the log above for the first error.';
    case 'starting':
      return `The container couldn't start.${tail}`;
    default:
      return error instanceof Error ? error.message : String(error);
  }
}

/** Re-assembles streamed chunks into whole lines. */
class LineSplitter {
  private buffer = '';

  constructor(private readonly emit: (line: string) => void) {}

  push(chunk: string): void {
    this.buffer += chunk;
    const parts = this.buffer.split(/\r?\n/);
    this.buffer = parts.pop() ?? '';
    for (const part of parts) this.emit(part);
  }

  flush(): void {
    if (this.buffer) this.emit(this.buffer);
    this.buffer = '';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Removes an app from a server: its containers (Traefik stops routing to
 * them), images and files. Safe to run more than once.
 *
 * @param runner - Open connection
 * @param app - App ID (validated)
 * @returns Names of the removed containers
 * @throws {Error} For an invalid app ID
 */
export async function teardownApp(runner: CommandRunner, app: string): Promise<string[]> {
  if (!APP_ID.test(app)) throw new Error(`Invalid app ID: ${app}`);
  const { stdout } = await runner.exec(
    [
      `names=$(docker ps -a --filter ${sh(`label=selfship.app=${app}`)} --format '{{.Names}}')`,
      '[ -n "$names" ] && echo "$names" | xargs -r docker rm -f >/dev/null',
      `docker images ${sh(`selfship/${app}`)} -q | sort -u | xargs -r docker rmi -f >/dev/null 2>&1 || true`,
      `rm -rf ${sh(`${APPS_DIR}/${app}`)}`,
      // Sandbox apps have their own network.
      `docker network disconnect -f ${sh(`sbx-${app}`)} selfship-traefik >/dev/null 2>&1 || true`,
      `docker network rm ${sh(`sbx-${app}`)} >/dev/null 2>&1 || true`,
      'echo "$names"',
    ].join('\n'),
    { sudo: true, timeoutMs: 5 * 60_000 },
  );
  return stdout
    .split('\n')
    .map((name) => name.trim())
    .filter(Boolean);
}
