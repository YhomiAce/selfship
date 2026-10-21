# Walkthrough: deployments, SSH and live logs (M4–M6)

How to trace a deployment from the Deploy button to commands on the server and back, where every log line goes, and what each internal package does. Line numbers are as of 2026-10-21.

## First: make "Go to Definition" open the source

The packages in `packages/*` are compiled to `dist/` (apps import `@selfship/remote`, which resolves to `packages/remote/dist/index.js` + `.d.ts`). Without **declaration maps**, Cmd/Ctrl+click stops at `dist/*.d.ts`, which only has types, no logic.

Each package's `tsconfig.json` now has `"declarationMap": true`, so each `dist/x.d.ts` has a `x.d.ts.map` pointing back to `src/x.ts`. After pulling:

1. `pnpm build` (or `pnpm turbo run build --filter='./packages/*'`) to regenerate the maps
2. In VS Code: Command Palette → **TypeScript: Restart TS Server**

Cmd+click on `AppDeployer` in the worker now opens [`packages/remote/src/deploy.ts`](../../packages/remote/src/deploy.ts). If it ever lands in `dist/` again, that package wasn't rebuilt.

**Editing a package while the apps run:** root `pnpm dev` runs only the apps, so the apps keep using the last build of each package. Either rebuild after a change (`pnpm --filter @selfship/remote build`), or keep the packages rebuilding in a second terminal:

```bash
pnpm turbo run dev --parallel --filter='./packages/*'   # tsc --watch for every package
```

The API and worker (`nest start --watch`) then restart when a package's `dist/` changes.

## The packages (and who uses them)

| Package                                                 | What it is                                                                                                                                         | Used by             | Start reading at                                                                                                                             |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@selfship/shared`](../../packages/shared/src)         | Contracts: zod schemas, DTO types, queue names/payloads, Redis key helpers, the rule-based failure explainer, `.env` parser. **No I/O**            | api, worker, web    | [`queues/index.ts`](../../packages/shared/src/queues/index.ts), [`deployments/explain.ts`](../../packages/shared/src/deployments/explain.ts) |
| [`@selfship/db`](../../packages/db)                     | Prisma schema, migrations, generated client                                                                                                        | api, worker         | [`prisma/schema.prisma`](../../packages/db/prisma/schema.prisma)                                                                             |
| [`@selfship/remote`](../../packages/remote/src)         | **Everything that touches a server over SSH**: the connection, pre-flight, setup script, the deploy pipeline, teardown, DNS/TLS checks, swap/prune | worker, api         | [`ssh.ts`](../../packages/remote/src/ssh.ts), [`deploy.ts`](../../packages/remote/src/deploy.ts)                                             |
| [`@selfship/adapters`](../../packages/adapters/src)     | Project-type detection (Next.js, SPA, Node, static, Dockerfile) and generated Dockerfiles                                                          | api, worker, remote | [`registry.ts`](../../packages/adapters/src/registry.ts), [`dockerfile.ts`](../../packages/adapters/src/dockerfile.ts)                       |
| [`@selfship/github`](../../packages/github/src)         | GitHub App client (installation tokens, repos, files, commits), webhook signature check                                                            | api, worker         | [`client.ts`](../../packages/github/src/client.ts)                                                                                           |
| [`@selfship/crypto`](../../packages/crypto/src)         | Envelope encryption (SSH keys, env var values)                                                                                                     | api, worker         | [`envelope.ts`](../../packages/crypto/src/envelope.ts)                                                                                       |
| [`@selfship/cloudflare`](../../packages/cloudflare/src) | Cloudflare DNS client (free subdomains)                                                                                                            | api, worker         | [`client.ts`](../../packages/cloudflare/src/client.ts)                                                                                       |
| [`tools/deploy-spike`](../../tools/deploy-spike)        | The M3 spike CLI (kept to reproduce `docs/spike-results.md`). Not used by the product                                                              | nobody              | —                                                                                                                                            |
| [`tools/mock-github`](../../tools)                      | Fake GitHub for local demos                                                                                                                        | dev only            | —                                                                                                                                            |

Rule of thumb: **apps orchestrate, packages do the work.** The worker decides _what_ to do and records it in the database; `@selfship/remote` knows _how_ to do it on a server.

## Why you don't see SSH in the worker

The deploy pipeline in `@selfship/remote` never imports `ssh2`. It takes anything with an `exec()` method:

```ts
// packages/remote/src/ssh.ts:45
export interface CommandRunner {
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
}
```

The worker opens a real SSH connection and passes it in:

```ts
// apps/worker/src/deployments/deployment.runner.ts
ssh = (await this.connector.connect(server)).ssh; // :233  → SshConnection
deployer = new AppDeployer(ssh, plan, hooks); // :244  → ssh is the CommandRunner
const outcome = await deployer.run(); // :279
```

So **every `this.runner.exec(...)` and `this.step(...)` inside [`deploy.ts`](../../packages/remote/src/deploy.ts) is a command running on the user's server over SSH.** Tests pass a fake runner instead (that's why the interface exists), see [`deploy.spec.ts`](../../packages/remote/src/deploy.spec.ts).

Where the SSH actually happens:

| Step                                                                              | Code                                                                                      |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Decrypt the server's key, check the host isn't private, connect, pin the host key | [`server-connector.ts:47`](../../apps/worker/src/servers/server-connector.ts#L47)         |
| Open the connection (ssh2), verify the host fingerprint                           | [`ssh.ts:123`](../../packages/remote/src/ssh.ts#L123) `SshConnection.connect`             |
| Run one command (`sudo -n bash -c '…'`), stream stdout/stderr, timeout            | [`ssh.ts:180`](../../packages/remote/src/ssh.ts#L180) `exec` → `this.client.exec` at :186 |
| Quote every value put into a command                                              | [`ssh.ts:94`](../../packages/remote/src/ssh.ts#L94) `sh()`                                |

## Tracing one deployment, end to end

```
Browser                  API (apps/api)                 Redis (BullMQ)        Worker (apps/worker)                    User's server
───────                  ──────────────                 ──────────────        ────────────────────                    ─────────────
Deploy ──POST /api/projects/:id/deployments──►
  (Next.js rewrites /api/* → API)
                         controller.create
                         service.create: checks, GitHub
                           commit, row in `deployments`
                         queue.add('run',{deploymentId}) ──► deployments queue ──► DeploymentsProcessor.process
                                                                                   DeploymentRunner.run → claim → execute
                                                                                     decrypt env vars, get clone token
                                                                                     DomainRoutingService.prepare (hosts)
                                                                                     ServerConnector.connect ───────── SSH ──►
                                                                                     AppDeployer.run:
                                                                                       clone  ── git fetch (token on stdin) ─►
                                                                                       build  ── docker build ──────────────►
                                                                                       start  ── docker run (labels) ───────►
                                                                                       health ── docker inspect / curl ─────►
                                                                                       switch ── docker stop old ───────────►
                                                                                     mark live, previous → replaced
```

1. **Click Deploy** → [`project-detail.tsx`](../../apps/web/src/app/dashboard/projects/[id]/project-detail.tsx) calls `deploymentsApi.create` → `POST /api/projects/:id/deployments`. Next.js proxies `/api/*` to the API ([`next.config.ts:24`](../../apps/web/next.config.ts#L24)).
2. **API** [`deployments.controller.ts:49`](../../apps/api/src/deployments/deployments.controller.ts#L49) → [`deployments.service.ts:66`](../../apps/api/src/deployments/deployments.service.ts#L66) `create`: server ready? GitHub access? resolves the branch to a commit, then [`launch` (:369)](../../apps/api/src/deployments/deployments.service.ts#L369) locks the project row, inserts the `deployments` row (`status: queued`) and adds a BullMQ job **carrying only the ID** (no secrets in Redis).
   - Pushes arrive the same way through [`github-webhooks.controller.ts:110`](../../apps/api/src/webhooks/github-webhooks.controller.ts#L110) → [`auto-deploy.service.ts:49`](../../apps/api/src/deployments/auto-deploy.service.ts#L49).
3. **Worker** picks the job: [`deployments.processor.ts:43`](../../apps/worker/src/deployments/deployments.processor.ts#L43) → [`deployment.runner.ts:103`](../../apps/worker/src/deployments/deployment.runner.ts#L103) `run` → [`claim` (:134)](../../apps/worker/src/deployments/deployment.runner.ts#L134) (one build per server, one deployment per project; otherwise the job waits 5 s and retries) → [`execute` (:162)](../../apps/worker/src/deployments/deployment.runner.ts#L162).
4. **`execute`** prepares everything, then hands over to the engine:
   - env vars decrypted, the GitHub clone token minted, or for rollbacks the earlier image chosen: [`resolveSource` (:364)](../../apps/worker/src/deployments/deployment.runner.ts#L364)
   - hostnames (free subdomain, custom domains, sslip.io): [`domain-routing.service.ts:99`](../../apps/worker/src/domains/domain-routing.service.ts#L99)
   - SSH connection (:233) and `new AppDeployer(...)` (:244) with two **hooks**: `log` (:265) and `stage` (:268)
5. **`AppDeployer.run`** [`deploy.ts:206`](../../packages/remote/src/deploy.ts#L206) calls each stage in order. Each stage is a few SSH commands:

   | Stage          | Method                                                           | What runs on the server                                                                                                                               |
   | -------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `cloning`      | [`clone` :271](../../packages/remote/src/deploy.ts#L271)         | `git init` + `git fetch` of the exact commit (:287), token read from stdin                                                                            |
   | `building`     | [`build` :305](../../packages/remote/src/deploy.ts#L305)         | writes the generated Dockerfile, `docker build --progress=plain` (:336) with build args                                                               |
   | `starting`     | [`start` :377](../../packages/remote/src/deploy.ts#L377)         | `docker run -d` (:459) with Traefik labels, `PORT`, runtime env, sandbox limits                                                                       |
   | `health_check` | [`waitHealthy` :501](../../packages/remote/src/deploy.ts#L501)   | `docker inspect` (running? healthy?) + `curl` to the container's IP until HTTP < 500                                                                  |
   | `switching`    | [`switchTraffic` :549](../../packages/remote/src/deploy.ts#L549) | waits 3 s for Traefik, then `docker stop` + `docker rm` the old containers; [`cleanup` :572](../../packages/remote/src/deploy.ts#L572) keeps 3 images |

   Long steps go through [`step()` :598](../../packages/remote/src/deploy.ts#L598): `setsid --wait bash -c '…'` (:609) runs them in their own process group with a pid file, so [`cancel()` :249](../../packages/remote/src/deploy.ts#L249) can `kill` the whole group on the server.

6. **Back in the runner**: on success the row becomes `live` and the previous one `replaced`; on failure `failed` with `failedStage`, `errorSummary` and a rule-based hint, then Build Doctor is requested (:348).

## Where the logs go

```
server stdout/stderr
   │  (ssh2 channel 'data' events)          packages/remote/src/ssh.ts:186
   ▼
ExecOptions.onOutput(chunk)  →  LineSplitter (whole lines)   packages/remote/src/deploy.ts:692
   ▼
hooks.log(line)                                              deployment.runner.ts:265
   ▼
LiveLog.line(text): mask secrets, keep in memory, XADD       apps/worker/src/logs/live-log.ts:55, :120
   ├──► Redis Stream  selfship:deployment:<id>:log           (live; expires 24 h after the end)
   └──► every 2 s: DeploymentLogChunk rows in Postgres        deployment.runner.ts:174 (the saved log)

Browser                                                      API
EventSource('/api/projects/:p/deployments/:d/stream')  ──►  DeploymentsController.stream  :131
  log-viewer.tsx:61                                          LogStreamService.relay  log-stream.service.ts:50
  ◄── SSE "data: {json}" ────────────────────────────────── XREAD BLOCK on the Redis Stream  :91
                                                            (stream expired? replays the Postgres chunks)
```

- **Producer (worker).** Lines from `docker build` etc. arrive as SSH output chunks, are re-assembled into whole lines, and go through `hooks.log` into [`LiveLog`](../../apps/worker/src/logs/live-log.ts). `LiveLog` masks secrets first ([`Masker`](../../apps/worker/src/logs/masker.ts): env values and the GitHub token), then appends each line to the Redis Stream as one JSON field (`{"type":"line","line":"…"}`). Stage changes are `{"type":"stage",…}`, the end is `{"type":"end","status":…,"error":…}`. Our own status lines (`→ Building…`, `✓ Image built`) come from `this.hooks.log(...)` calls inside `deploy.ts` and the runner.
- **Saved copy.** A 2-second timer (`ticker`, runner :190) writes new text to `deployment_log_chunks` (:180). That's the permanent record and what Build Doctor reads.
- **Consumer (API → browser).** The browser opens an `EventSource`; the API's [`LogStreamService`](../../apps/api/src/logs/log-stream.service.ts) reads the stream from the start (`XREAD … 0`), then blocks for new entries and forwards each as an SSE event. The event ID is the Redis entry ID, so a reconnecting browser resumes exactly where it stopped. Server check/setup jobs use the same mechanism with `selfship:server-job:<id>:log`.

## Watching it yourself

While a deployment runs (local stack, default ports):

```bash
# 1. The worker's own log (not the build log): what it's doing and any warnings
pnpm --filter @selfship/worker dev            # or tail the worker terminal; LOG_LEVEL=debug for more

# 2. The live build log in Redis (what the browser receives)
docker exec -it selfship-dev-redis-1 redis-cli XRANGE selfship:deployment:<deployment-id>:log - +
#    (with QUEUE_PREFIX the stream keys are unchanged; only BullMQ keys are prefixed)

# 3. The saved log and the deployment state in Postgres
docker exec -it selfship-dev-postgres-1 psql -U selfship -d selfship -c \
  "select status, failed_stage, stages from deployments where id = '<deployment-id>';"
docker exec -it selfship-dev-postgres-1 psql -U selfship -d selfship -c \
  "select seq, left(content, 200) from deployment_log_chunks where deployment_id = '<deployment-id>' order by seq;"

# 4. The SSE stream exactly as the browser sees it (needs your session cookie)
curl -N -b 'sid=<cookie>' http://localhost:3000/api/projects/<project-id>/deployments/<deployment-id>/stream

# 5. On the server: what Selfship created
ssh ubuntu@<server> 'sudo docker ps --format "{{.Names}} {{.Status}}"; sudo ls /opt/selfship/apps'
ssh ubuntu@<server> 'sudo docker logs --tail 50 <container-name>'      # the app's own output
ssh ubuntu@<server> 'sudo docker logs --since 10m selfship-traefik'    # routing/certificate issues
```

To step through the code: run the worker under the debugger (VS Code → "JavaScript Debug Terminal", then `pnpm --filter @selfship/worker dev`) and put breakpoints in `deployment.runner.ts` and `packages/remote/src/deploy.ts` (source maps are on).

## Other background flows (same pattern: API queues an ID, worker does the work)

| Flow                             | Starts at                                                                                 | Worker code                                                                                                                                                           |
| -------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server check / setup             | `POST /servers/:id/setup`                                                                 | [`server-job.runner.ts`](../../apps/worker/src/servers/server-job.runner.ts) → `preflight`, `bootstrapServer` in `@selfship/remote`                                   |
| Teardown (project deleted/moved) | [`projects.service.ts`](../../apps/api/src/projects/projects.service.ts) `remove`         | [`teardown.service.ts`](../../apps/worker/src/deployments/teardown.service.ts) → `teardownApp`                                                                        |
| Domain checks (every minute)     | scheduler in [`domains.processor.ts`](../../apps/worker/src/domains/domains.processor.ts) | [`domain-checker.service.ts`](../../apps/worker/src/domains/domain-checker.service.ts)                                                                                |
| Build Doctor                     | runner after a failure, or `POST …/diagnosis`                                             | [`build-doctor.service.ts:117`](../../apps/worker/src/build-doctor/build-doctor.service.ts#L117) → [`claude.ts:55`](../../apps/worker/src/build-doctor/claude.ts#L55) |
| Sandbox expiry (hourly)          | scheduler in [`system.processor.ts`](../../apps/worker/src/system/system.processor.ts)    | [`sandbox-expiry.service.ts`](../../apps/worker/src/deployments/sandbox-expiry.service.ts)                                                                            |
