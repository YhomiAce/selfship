# Discussion Log

## Session 1 — 2026-10-12 — Kickoff

**Founder's brief** (original notes in [`../starter_notes.md`](../starter_notes.md)):
- Platform for developers to deploy any project (HTML/JS, Node frameworks, Spring Boot, PHP/Laravel, Go, Python...). Start with the basics and add adapters over time.
- Sign up / login with an intuitive UI (React/Next.js + TS)
- Connect GitHub and access the user's repos
- Deploy to the user's own server using their credentials (private key etc.). Build the project, set up nginx/traefik, handle custom domains.
- Started thinking AWS/GCP, but the profit is in VPS users (Hostinger, Namecheap, WhoGoHost, GoDaddy)
- Env vars: entered one by one or pasted as a `.env` block
- Questions raised: best tech? one language first? Docker for some people? GitHub Actions needed?

**What we proposed** (details in docs 00–05):
- Stack: NestJS + Next.js + Postgres + Redis/BullMQ, TypeScript monorepo. Go later for a server agent.
- Docker for *every* app (not some). Traefik for routing + automatic SSL.
- Treat every server as "Ubuntu + SSH". This covers AWS, GCP and every VPS with one code path.
- GitHub App + webhooks instead of GitHub Actions in user repos.
- MVP: JS ecosystem + Dockerfile passthrough. Other languages in Phase 2.
- Flagged: shared/cPanel hosting can't be supported. VPS only.
- Flagged: security of stored SSH keys is critical. Prefer generating our own keypair per server.
- Next step: a **spike** script that deploys a Next.js app to a real VPS over SSH with Docker + Traefik + HTTPS.

**Open questions:** see [06-open-questions.md](06-open-questions.md).

## Session 2 — 2026-10-13 — Decisions & implementation plan

**Founder's answers** (original in [`../starter_notes.md`](../starter_notes.md)):
- Name TBD. Global market. All personas. Open source.
- MVP is VPS only, but plan for shared hosting that has SSH without root (founder's own Namecheap server is an example).
- The lowest servers should still be able to deploy a plain HTML site.
- Ubuntu + Debian, many apps per server (low budget), Prisma, Cloudflare accepted.
- A free "try it now" tier is wanted, which may need our own instances.
- Per-app pricing with a test payment account. Solo founder, 20 h/week. Claude writes code and docs, founder reviews and tests.
- Open to a Go microservice for provisioning if that's the better call.
- Clean modular code, comments on every method, typed bodies and signatures.
- Add an AI agent (Claude) that diagnoses build errors and gives detailed fixes.

**What we decided** (decision log #11–#24):
- Capability tiers so 512 MB servers can host static sites ([03](03-deployment-engine.md#server-requirements)).
- Free sandbox = a few shared platform-owned VPSes with strict container limits, not one VM per user ([09](09-free-tier-sandbox.md)).
- **No Go microservice yet.** Stay a modular TypeScript monolith; clear criteria for when to split out Go.
- Coding standards written ([07](07-coding-standards.md)): zod schemas shared between API and web, TSDoc on every method, no `any`.
- Build Doctor designed ([08](08-ai-build-doctor.md)): rules first, Claude second, enum-only actions, redaction, quotas. Needs its own Anthropic API key.
- Dated implementation plan ([implementation/](implementation/README.md)): Phase 0 starts now, public beta target 2027-02-14.

**Next:** confirm the license (AGPL-3.0?), then start Phase 0.

## Session 3 — 2026-10-14 — License, payments, test infra

- License **AGPL-3.0** accepted. Payments: founder has **Stripe and Paystack** test keys.
- Created Terraform for Phase 0 test servers in [`infra/aws/test-servers`](../infra/aws/test-servers/README.md): 2 Ubuntu 24.04 servers (1 GB + 2 GB), Elastic IPs, a security group (SSH from admin IP only), optional budget alert. `make up / stop / down`.
- Added a root `.gitignore` (env files, tfstate, tfvars).
- Founder is opening a Cloudflare account. Has a GitHub account.

## Session 4 — 2026-10-14 — Local-first

- Founder doesn't want to deploy to servers or set up deployment for the platform yet.
- Decision #28: all development and testing runs locally. Deploys target a **fake VPS** (Ubuntu + SSH + Docker in a container) on the developer's machine. See [10-local-development.md](10-local-development.md).
- AWS Terraform stays in the repo, unapplied, until we need a real server.

## Session 5 — 2026-10-14 — No fake VPS, start building

- Founder: no fake VPS. Use the AWS VPS once we reach the deployment stage. Start scaffolding and implementing now.
- Decision #28 revised, #29 (NestJS 11 + TS 6 for ecosystem compatibility), #30 (deploy spike moved to M3).
- Implementation started: Phase 0 scaffold, then M1 (auth).
