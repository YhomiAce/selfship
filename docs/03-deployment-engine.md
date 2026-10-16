# 03 — Deployment Engine

This is the core of the product and where most of the work is.

## Decision: Docker for everyone (not "Docker for some people")

Every app runs in a Docker container, including plain HTML sites.

**Why:**

- **One deploy path.** Without Docker we'd install Node 18, Node 20, PHP 8.2, Java 21, Python 3.12... directly on servers and fight version conflicts. With Docker, each app brings its own runtime.
- **Isolation.** App A can't break App B.
- **Rollback.** The previous image is still there, so rolling back is just restarting it.
- **Adapters become simple.** Supporting a new language = writing one Dockerfile template.
- **"Bring your own Dockerfile" or docker-compose** gives us support for _any_ language from day one, for users who already have a Dockerfile.

**Trade-off:** Docker uses some RAM and disk, and builds on a 1 GB VPS can run out of memory (Next.js builds are heavy). Mitigations: add swap during bootstrap, use multi-stage builds, and later offer remote builds (see below).

## Adapters (framework detection + build)

An **adapter** is a small module with two jobs:

```ts
interface Adapter {
  name: string; // "nextjs"
  detect(files: RepoSnapshot): DetectResult | null; // looks at package.json, etc.
  defaults(): { buildCmd?: string; startCmd?: string; port: number };
  dockerfile(config: AppConfig): string; // renders the Dockerfile
}
```

Detection order (first match wins):

1. `Dockerfile` in repo → **use it as-is**
2. `docker-compose.yml` → compose mode (Phase 2)
3. `package.json` with `next` → **nextjs**
4. `package.json` with `vite` / `react-scripts` / `@angular/core` / `vue` and no server → **static SPA** (build, then serve with nginx or Caddy)
5. `package.json` with `start` script → **node** (Express, Fastify, NestJS...)
6. `index.html` at root → **static**
7. Phase 2: `composer.json` + `artisan` → laravel, `composer.json` → php, `go.mod` → go, `requirements.txt` / `pyproject.toml` → python, `pom.xml` / `build.gradle` → java/spring
8. Nothing matched → ask the user

Package manager detection: `pnpm-lock.yaml` / `yarn.lock` / `bun.lockb` / `package-lock.json`.

**Build our own templates or use Railpack / Nixpacks / Buildpacks?**

- Tools exist that auto-generate builds: **Railpack** (Railway's successor to Nixpacks), **Nixpacks**, and **Cloud Native Buildpacks**. Coolify and Dokploy use them.
- **Recommendation for MVP:** write our **own templates for 4–5 frameworks**. You'll learn how builds actually work, error messages stay under our control, and the images stay small. Re-evaluate Railpack when we add more languages, since it could become one big "fallback adapter".

## Reverse proxy: Traefik

**Traefik**, not Nginx, on user servers:

- Traefik watches Docker and **routes based on container labels**. Deploying a new app = starting a container with labels. No config files to write, no reloads.
- **Automatic Let's Encrypt SSL** per domain, with auto renewal.
- Zero-downtime switching comes almost for free: start the new container, it becomes healthy, Traefik routes to it, stop the old one.

Example of what the worker runs:

```bash
docker run -d --name app-a-<sha> --network traefik \
  --env-file /opt/platform/apps/app-a/.env \
  --label traefik.enable=true \
  --label 'traefik.http.routers.app-a.rule=Host(`myapp.com`)' \
  --label traefik.http.routers.app-a.tls.certresolver=le \
  --label traefik.http.services.app-a.loadbalancer.server.port=3000 \
  --restart unless-stopped \
  app-a:<sha>
```

(Caddy is a good alternative. Nginx would mean generating config files and reloading, which is more work and easier to break.)

## Where does the build happen?

| Option                                                 | Pros                                    | Cons                                                          | When               |
| ------------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------- | ------------------ |
| **A. On the user's VPS**                               | Free for us, simple, no registry needed | Small VPSes can run out of memory; builds slow down live apps | **MVP**            |
| B. On our build servers → push to registry → VPS pulls | Fast, reliable, VPS only runs apps      | Costs us compute and registry storage                         | Paid tier, Phase 3 |
| C. In the user's GitHub Actions → registry → VPS pulls | Free runners for the user               | Needs a workflow in their repo, more setup                    | Optional, Phase 3  |

## Server requirements

Pre-flight measures each server and assigns a **capability tier**, so even the smallest server can host a plain HTML site.

| Tier          | RAM                                  | vCPU | Disk   | Can deploy                                                                           |
| ------------- | ------------------------------------ | ---- | ------ | ------------------------------------------------------------------------------------ |
| `static-only` | 512 MB                               | 1    | 10 GB  | Static HTML/JS sites, pre-built SPAs (via Dockerfile passthrough or prebuilt output) |
| `standard`    | 1 GB (+2 GB swap added by bootstrap) | 1    | 20 GB  | Above + Node APIs, SPA builds. Next.js _may_ work (spike will confirm)               |
| `recommended` | 2 GB+                                | 1–2  | 25 GB+ | Everything in MVP, several apps at once                                              |

All tiers need:

- **OS:** Ubuntu 22.04 / 24.04 LTS or Debian 12 / 13
- **Arch:** x86_64 or arm64
- **Access:** root or passwordless sudo over SSH
- **Network:** ports 80 and 443 reachable (some providers have an extra firewall in their panel, and the UI reminds users of it)

Docker + Traefik idle cost is roughly 100–150 MB RAM (to be confirmed in the spike), and each static site container (nginx:alpine) adds only a few MB.

## Server layout (on user's VPS)

```
/opt/<platform>/
├── traefik/          # traefik config + acme.json (certs)
└── apps/
    └── <app-id>/
        ├── src/      # latest clone (deleted after build)
        └── .env      # runtime env (chmod 600)
```

For now we connect as the user the founder adds (root or passwordless sudo). A `deployer` user in the `docker` group is deferred, because that group is root-equivalent anyway (decision log #46).

## Env vars UX

- Key/value table with add/remove rows
- "Paste .env" textarea that parses into the table (handles comments, quotes, `export` prefix)
- Mark vars as **build-time** (e.g. `NEXT_PUBLIC_*`) or **runtime**
- Values hidden by default with a reveal button. Encrypted in our DB.
- Changing env vars → offer "Redeploy now"

## Failure handling (this is where UX wins)

Turn common failures into human messages:

- `ENOMEM` / exit 137 → "Your server ran out of memory during build. Try adding swap or upgrading to 2 GB RAM."
- Port mismatch / health check timeout → "Your app didn't respond on port 3000. Is it listening on `0.0.0.0` and on `process.env.PORT`?"
- DNS not pointing → "myapp.com points to 1.2.3.4, but your server is 5.6.7.8."
- Let's Encrypt rate limits, SSH auth failures, disk full...

## Databases (Phase 2)

One-click Postgres / MySQL / Redis / MongoDB containers on the same server, with a persistent volume and an auto-generated connection string injected into the app's env. Scheduled backups to S3-compatible storage later.
