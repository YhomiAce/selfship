# Selfship

**Selfship deploys any app from GitHub to your own server.** Connect a repo, add your VPS, click deploy. The platform builds the app, sets up the reverse proxy and SSL, and redeploys on every push.

> Status: early development. Sign-up, login (email or GitHub), email verification and password reset work locally. Deployments come in later milestones.

## Repository layout

```
apps/
  api/        NestJS REST API
  worker/     NestJS background job processor (BullMQ)
  web/        Next.js dashboard
packages/
  shared/     zod schemas + types shared by api, worker and web
  db/         Prisma schema, migrations and client
  adapters/   Framework detection + Dockerfile generation
docs/         Product, architecture and planning docs (start at docs/README.md)
infra/        Terraform for test servers
```

## Quick start

Requirements: Node 22, pnpm (`corepack enable`), Docker.

```bash
cp .env.example .env
pnpm install
pnpm infra:up          # Postgres, Redis, Mailpit
pnpm db:deploy         # apply database migrations
pnpm dev               # web :3000, api :4000, worker
```

Check that everything is wired up:

```bash
curl localhost:4000/health
curl -X POST localhost:4000/diagnostics/ping-worker
```

More in [docs/10-local-development.md](docs/10-local-development.md).

## Scripts

| Command                                      | Description                                              |
| -------------------------------------------- | -------------------------------------------------------- |
| `pnpm dev`                                   | Run all apps in watch mode                               |
| `pnpm build`                                 | Build everything                                         |
| `pnpm lint` · `pnpm typecheck` · `pnpm test` | Quality checks (same as CI)                              |
| `pnpm --filter @selfship/api test:e2e`       | API integration tests (needs `pnpm infra:up`)            |
| `pnpm db:migrate`                            | Create/apply a migration after editing the Prisma schema |
| `pnpm format`                                | Format all files with Prettier                           |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [coding standards](docs/07-coding-standards.md).

## License

[AGPL-3.0](LICENSE)
