# Phase 0 — Foundations

**Dates:** 2026-10-13 → 2026-10-26 (2 weeks)
**Goal:** A clean, open-source-ready monorepo with CI, running fully on your machine. (The deploy spike moved to M3, see decision #30.)

---

## Week 1 — Repo & tooling

### Tasks

- [ ] `git init`, pnpm workspace, Turborepo, Node 22 LTS pinned (`.nvmrc`, `engines`)
- [ ] `tsconfig.base.json` with `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- [ ] ESLint (typescript-eslint strict + `explicit-function-return-type`, `no-explicit-any`), Prettier
- [ ] Husky + lint-staged + commitlint (conventional commits)
- [ ] `LICENSE` (AGPL-3.0), `README.md`, `CONTRIBUTING.md` stub, `SECURITY.md`
- [ ] `docker-compose.dev.yml`: Postgres 16, Redis 7, Mailpit (catches dev emails)
- [ ] `apps/api`: NestJS skeleton
  - `ConfigModule` with **zod-validated env** (app refuses to start if config is invalid)
  - Structured logging (pino) with secret redaction
  - `GET /health` (DB + Redis checks)
  - Global zod validation pipe, global exception filter with a consistent error shape
- [ ] `apps/worker`: NestJS standalone app with a BullMQ consumer and a "hello" job
- [ ] `apps/web`: Next.js (App Router) + Tailwind + shadcn/ui, with a landing placeholder and an API client wrapper
- [ ] `packages/shared`: zod schemas + inferred types (the single source of truth for request/response bodies)
- [ ] `packages/db`: Prisma schema (only `User` for now), migrations, client export
- [ ] `packages/adapters`: empty package with the `Adapter` interface and test setup

### CI (GitHub Actions)

- [ ] `ci.yml` on every PR: install (pnpm cache), lint, typecheck, unit tests, build. Postgres + Redis service containers for integration tests
- [ ] Dependabot for npm + GitHub Actions
- [ ] CodeQL (free for public repos)

## Week 2 — The deploy spike → moved to M3

The spike needs a real server, so it now opens **M3 (Servers)** and runs against the AWS test VPS (`infra/aws/test-servers`). See decision #30.

---

## Deliverables

- Monorepo running locally with `pnpm dev` (web on :3000, api on :4000, worker connected)
- Green CI

## What you'll test

- [ ] Clone the repo, `pnpm install`, `docker compose -f docker-compose.dev.yml up -d`, `pnpm dev`. Everything starts
- [ ] `curl localhost:4000/health` returns ok
- [ ] Open a PR with a lint error. CI fails

## You provide

- Docker on your machine. Nothing else.
