# 01 — Tech Stack

## Recommendation

**TypeScript end to end: NestJS (backend + workers) + Next.js (frontend), in one monorepo.**

| Layer                   | Choice                                                                      | Why                                                                                   |
| ----------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Frontend                | **Next.js (App Router) + TypeScript + Tailwind + shadcn/ui**                | You know it. shadcn gives a clean, intuitive UI fast                                  |
| API                     | **NestJS**                                                                  | Your strongest framework. Modules, DI and guards fit this domain well                 |
| Deploy workers          | **NestJS standalone app + BullMQ**                                          | Same codebase and types. Deploys are long-running background jobs                     |
| Database                | **PostgreSQL + Prisma**                                                     | Relational data (users → servers → apps → deployments). Prisma is easy to learn       |
| Queue / cache / pub-sub | **Redis** (BullMQ jobs, live log streaming)                                 | Standard choice, simple to run                                                        |
| SSH                     | **`ssh2`** (npm)                                                            | Mature library. Exec commands, stream output, SFTP                                    |
| Live logs               | **WebSockets (Socket.IO via `@nestjs/websockets`)** or SSE                  | Users watch the build in real time                                                    |
| Auth                    | Email/password (argon2) + **GitHub login**, session/JWT in httpOnly cookies | Keep it in-house. It's simple and you learn it properly                               |
| GitHub integration      | **GitHub App** (not an OAuth App)                                           | Per-repo permissions, short-lived tokens, push webhooks. See [02](02-architecture.md) |
| Secrets encryption      | **libsodium / AES-256-GCM** with a master key (later: AWS KMS / Vault)      | SSH keys and env vars are encrypted at rest                                           |
| Monorepo                | **pnpm + Turborepo**                                                        | Shared types between web, api and worker                                              |
| On the user's server    | **Docker + Traefik**                                                        | See [03](03-deployment-engine.md)                                                     |
| Our hosting (to start)  | One VPS for the platform itself, using Docker Compose                       | Use our own product as soon as we can                                                 |

## Why not Go or Spring Boot?

- **Go** is the language of infra tools (Docker, Traefik and Kubernetes are written in Go) and would be great here. But speed of shipping matters most for a startup, and you're fastest in NestJS. Our backend mostly **waits on SSH and network I/O**, which Node handles well. CPU-heavy work (builds) happens on the user's server, not on ours.
  - **Where Go comes in later:** a small **agent** binary installed on user servers (Phase 3) to replace SSH push. That's a good, contained project for learning Go.
- **Spring Boot** works, but it's heavier, slower to iterate on, and gives us nothing extra here.

## Monorepo layout (proposed)

```
/
├── apps/
│   ├── web/          # Next.js dashboard
│   ├── api/          # NestJS REST + WebSocket API
│   └── worker/       # NestJS standalone: consumes deploy jobs, talks SSH
├── packages/
│   ├── shared/       # Shared types, DTOs, zod schemas
│   ├── adapters/     # Framework detection + Dockerfile templates
│   └── db/           # Prisma schema + client
├── docs/             # ← these docs
├── docker-compose.yml  # Local dev: postgres, redis
└── turbo.json
```

## Do we need GitHub Actions?

Two separate questions:

1. **For our own codebase: yes.** CI for lint, typecheck and tests on every PR, plus auto-deploy of the platform itself. Small effort, big safety net.
2. **For users' deployments: no, not for the MVP.** A **GitHub App webhook** tells us when the user pushes, and we build on their server. That way users don't add any YAML to their repo, which is the whole point.
   - _Later option:_ a "build in GitHub Actions" mode where we commit a workflow that builds the image on GitHub's runners and pushes to a registry. This helps users with tiny VPSes that can't handle builds. Nice to have, not v1.
