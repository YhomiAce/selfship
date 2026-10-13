# Decision Log

Format: **date — decision** · reason · status (proposed / accepted / superseded)

| # | Date | Decision | Reason | Status |
|---|------|----------|--------|--------|
| 1 | 2026-10-12 | Backend in **NestJS**, frontend in **Next.js**, TypeScript monorepo | Founder's strongest stack, shared types, I/O-bound workload suits Node | Accepted |
| 2 | 2026-10-12 | **Docker for every app** on user servers | One deploy path, isolation, rollback, easy adapters | Accepted |
| 3 | 2026-10-12 | **Traefik** as reverse proxy on user servers | Label-based routing, automatic SSL, no config files | Accepted |
| 4 | 2026-10-12 | **Generic SSH server** support, no AWS/GCP-specific integration in MVP | One implementation covers AWS, GCP and all VPS providers | Accepted |
| 5 | 2026-10-12 | **GitHub App** (not OAuth App) | Per-repo permissions, short-lived tokens, webhooks | Accepted |
| 6 | 2026-10-12 | **No GitHub Actions in users' repos** for MVP; webhooks instead. GitHub Actions only for our own CI | Zero setup for users | Accepted |
| 7 | 2026-10-12 | MVP languages: **static, SPA, Node, Next.js + Dockerfile passthrough** | Narrow scope, founder expertise, Dockerfile covers the rest | Accepted |
| 8 | 2026-10-12 | Build **on the user's VPS** in MVP | No infra cost for us. Remote builds later as a paid tier | Accepted |
| 9 | 2026-10-12 | Own Dockerfile templates per framework (not Railpack/Nixpacks) for MVP | Learning, control over errors, small images. Re-evaluate in Phase 2 | Accepted |
| 10 | 2026-10-12 | Postgres + **Prisma**, Redis + BullMQ | Standard, well documented, easy to learn | Accepted |
| 11 | 2026-10-13 | **Global market** from day one | Founder decision | Accepted |
| 12 | 2026-10-13 | Serve **all personas** (freelancers, agencies, indie devs, students) | Founder decision. Free sandbox serves beginners, per-app pricing scales for agencies | Accepted |
| 13 | 2026-10-13 | **Open source** under **AGPL-3.0** | Trust + adoption. AGPL protects the hosted business | Accepted |
| 14 | 2026-10-13 | **VPS only** in MVP. Shared hosting with SSH-but-no-root planned for Phase 3 | Shared hosting needs remote builds + rsync, a different deploy path | Accepted |
| 15 | 2026-10-13 | Capability tiers: **512 MB static-only**, 1 GB standard (+swap), 2 GB recommended | Lowest servers can still host plain HTML | Accepted |
| 16 | 2026-10-13 | **Ubuntu 22.04/24.04 + Debian 12/13**, x86_64 + arm64 | Near-identical bootstrap | Accepted |
| 17 | 2026-10-13 | **Many apps per server** via Traefik | Low cost for users and for us | Accepted |
| 18 | 2026-10-13 | **Free sandbox** on a few platform-owned VPSes (not a VM per user). Auto-scaling via cloud APIs in Phase 3 | Lowers the barrier for a few €/month instead of per-user VM cost | Accepted |
| 19 | 2026-10-13 | **Cloudflare** DNS for platform subdomains | Founder creating account | Accepted |
| 20 | 2026-10-13 | **Per-app pricing**, Stripe **test mode** first, behind a `PaymentProvider` interface | Founder decision. Live provider decided before launch | Accepted |
| 21 | 2026-10-13 | **Modular monolith** (api + worker processes) in TypeScript. **No Go microservice yet.** Go for the agent / provisioning in Phase 3 when the criteria in [phase-3](implementation/phase-3-scale.md#when-to-split-out-go-decision-criteria) are met | Solo founder at 20 h/week: one language and one deploy unit is far cheaper to run and debug | Accepted |
| 22 | 2026-10-13 | **zod schemas in `packages/shared`** as the single source for request/response types (`nestjs-zod` on the API, `zodResolver` on the web) | Typed bodies everywhere, validation defined once | Accepted |
| 23 | 2026-10-13 | **Build Doctor**: AI diagnosis of failed builds with Claude (`claude-opus-5-5`), structured output, allowlisted remediation only | Founder request. See [08](08-ai-build-doctor.md) | Accepted |
| 24 | 2026-10-13 | Solo founder, 20 h/week. Claude writes code/docs, founder reviews & tests. MVP public beta target **2027-02-14** | See [implementation plan](implementation/README.md) | Accepted |
| 25 | 2026-10-14 | Payments: **Stripe + Paystack**, both behind `PaymentProvider`. Test keys available | Stripe for global cards, Paystack for African cards | Accepted |
| 26 | 2026-10-14 | Phase 0 test servers on **AWS via Terraform** (`infra/aws/test-servers`), brought up/stopped/destroyed on demand | Cheap, reproducible, fresh "customer-like" servers for the spike | Accepted |
| 27 | 2026-10-14 | Secrets live only in gitignored `.env` files locally and a secrets manager in prod. Never in docs, notes or the repo | Repo will be public (open source) | Accepted |
| 28 | 2026-10-14 | **Local-first development** of the platform (web/api/worker + Postgres/Redis/Mailpit in Docker). **No fake VPS**: deploy testing uses a real AWS VPS from `infra/aws/test-servers` once we reach the deployment stage (M3). The platform itself is not deployed anywhere yet | Founder decision: avoid deployment setup until needed; real VPS gives realistic results | Accepted |
| 29 | 2026-10-14 | **NestJS 11** (CommonJS) + **TypeScript 6.0** instead of the newest NestJS 12 / TypeScript 7 | NestJS 12 is ESM-only, and `nestjs-zod`, `ts-jest` and `typescript-eslint` don't support NestJS 12 / TS 7 yet. NestJS 11 is still maintained. Upgrade once the ecosystem catches up | Accepted |
| 30 | 2026-10-14 | Deploy **spike moved from Phase 0 to the start of M3** (needs a real VPS) | Follows #28. Phase 0 = scaffolding only | Accepted |
