# 10 — Local Development

The platform runs on your machine. Nothing is deployed anywhere yet (decision #28). When we reach the deployment stage (M3), deploys go to a real AWS test VPS from [`infra/aws/test-servers`](../infra/aws/test-servers/README.md).

## Prerequisites

- Node 22 (`nvm use`, reads `.nvmrc`) and pnpm (`corepack enable`)
- Docker (for Postgres, Redis, Mailpit)

## Services and ports

Non-default host ports avoid clashes with other projects on the same machine.

| Service       | URL / port                                         | Notes                    |
| ------------- | -------------------------------------------------- | ------------------------ |
| Web (Next.js) | http://localhost:3000                              |                          |
| API (NestJS)  | http://localhost:4000                              | `GET /health`            |
| Worker        | (no port)                                          | Consumes BullMQ jobs     |
| Postgres 16   | `localhost:5434`                                   | user/pass/db: `platform` |
| Redis 7       | `localhost:6380`                                   |                          |
| Mailpit       | SMTP `localhost:1026`, inbox http://localhost:8026 | Catches all dev emails   |

## First run

```bash
cp .env.example .env            # fill in values; see comments in the file
pnpm install
pnpm infra:up                   # starts Postgres, Redis, Mailpit
pnpm db:deploy                  # applies Prisma migrations
pnpm dev                        # web + api + worker in watch mode
```

## Common commands

| Command                                      | What it does                                           |
| -------------------------------------------- | ------------------------------------------------------ |
| `pnpm dev`                                   | Run everything in watch mode                           |
| `pnpm build`                                 | Build all apps/packages                                |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | Quality checks (same as CI)                            |
| `pnpm db:migrate`                            | Create/apply a migration after editing `schema.prisma` |
| `pnpm db:studio`                             | Browse the database in Prisma Studio                   |
| `pnpm infra:down`                            | Stop Docker services (data is kept in volumes)         |

## Environment files

- `.env.example` (committed): every variable, with a description and a safe placeholder
- `.env` (gitignored): your real local values
- The API and worker validate env on startup with zod, and stop with a clear message if anything is missing

## Trying the auth flows

1. Open http://localhost:3000 and click **Get started**
2. After signing up, open Mailpit at http://localhost:8026 and click the confirmation link
3. Password reset emails also land in Mailpit
4. "Sign in with GitHub" needs an OAuth App: see [guides/github-oauth-setup.md](guides/github-oauth-setup.md)

Quick API checks without the UI:

```bash
curl localhost:4000/health
curl -X POST localhost:4000/diagnostics/ping-worker   # API → Redis → worker round trip
```
