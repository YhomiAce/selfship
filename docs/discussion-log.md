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
- Docker for _every_ app (not some). Traefik for routing + automatic SSL.
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

## Session 6 — 2026-10-14 — Phase 0 + M1 implemented

- **Phase 0 scaffold** (branch `feat/phase0-scaffold`): pnpm/Turborepo monorepo, NestJS 11 API + worker, Next.js 16 web, shared/db/adapters packages, Docker dev services, CI, AGPL license.
- **M1 auth** (branch `feat/m1-auth`, on top of the scaffold): email/password + GitHub sign-in, email verification, password reset, sessions, rate limiting, CSRF origin check, dashboard shell.
- Decisions #31–#35 (database sessions, `/api` rewrite, OAuth App for login, queued emails, lint-staged 15).
- Environment notes: Playwright can't install browsers on Ubuntu 20.04, so UI smoke tests use the locally installed Chrome. Git 2.25 is old; upgrading it would let us use the latest lint-staged.

## Session 7 — 2026-10-15 — M2 implemented

- Founder: continue implementation, don't miss anything.
- **M2** (branch `feat/m2-github`): GitHub App integration, framework detection, projects API and UI. Every M2 checklist item is done, plus two gaps found along the way:
  - **Ownership check** on the install callback (decision #39)
  - **Re-linking projects** after a reinstall (decision #41). Found while reviewing the uninstall screen
- A path-traversal bug (`../etc` as a repo name) was caught by the new integration tests and fixed in both the schema and the client.
- Decisions #38–#43.
- Founder action: register the GitHub App using `docs/guides/github-app-setup.md` (or try `pnpm mock:github` first).

## Session 8 — 2026-10-15 — Infrastructure + M3 deploy spike

- Founder: new AWS account (credits) in `eu-north-1`, bought **selfship.dev** and **selfship.app** on Cloudflare. GitHub App connected and working (made public).
- Fixed Terraform (invalid character in a rule description) and allowed SSH from the ISP's /24 because the founder's public IP rotates.
- **Deploy spike done** on both test servers. Key results: Next.js builds on 1 GB + swap (100 s) and 2 GB (73 s); static/SPA sites use < 1 MB each when running; idle baseline ~500 MB on AWS Ubuntu.
- Found and fixed a zero-downtime gap: Traefik routed to new containers before they were ready (1 × 502). Docker health checks fixed it (0 failures in 92 requests).
- Pending: Cloudflare DNS for `spike.selfship.dev` so real Let's Encrypt certificates can be verified.

## Session 9 — 2026-10-16 — M3 servers in the product

- Founder asked for a full code walkthrough of M2/M3 (written: [walkthrough](walkthroughs/m2-m3-github-projects-and-deploy.md)). Test servers left running for now (stop vs destroy: still to decide).
- Extracted the spike's SSH, pre-flight and bootstrap code into `packages/remote`; added `packages/crypto` (envelope encryption).
- Fixed the remaining zero-downtime gap found by a server-side probe: per-deployment Traefik routers + retry + settle delay (decision #48).
- Built servers end to end: API (add with 3 methods, check/setup jobs, SSE log stream, remove), worker jobs (pinning, pre-flight, setup), and the UI. Departed from the plan on Socket.IO (SSE instead, #44) and the `deployer` user (deferred, #46).
- Verified on AWS: all three methods, live setup log (~7–12 s on a prepared server), host-key mismatch refused, SSRF guard, ciphertext-only DB, password not stored anywhere, revoke command removes our key.
- Browser walkthrough found one UX bug (connect before adding the key hid the command), fixed (#51).

## Session 10 — 2026-10-16 — M4 deploy engine

- Built env vars (encrypted, scopes, paste .env), deployments (API, worker pipeline, live and saved logs with masking, cancel, teardown) and the project/deployment UI.
- Tested live on the AWS 2 GB server with real repos of the founder's GitHub account: a static site, a static sub-folder of a multi-project repo (sparse checkout), and a 2020 Create React App. A real Let's Encrypt certificate was issued for the sslip.io URL.
- The live test found three bugs, all fixed: the per-server build limit raced (#57), `ENV CI=true` blocked the user's `CI=false` (#58), and teardown skipped servers with only failed deployments. It also showed the old CRA needs `NODE_OPTIONS=--openssl-legacy-provider` and `CI=false`, both good examples for the Build Doctor (M6).
- Verified: zero downtime (606/606 requests during a redeploy), a broken build and a cancelled build leave the live version serving, secrets show as `••••••` in logs, an app that crashes on start (missing MongoDB) fails at the health check with its output, and deleting projects removes them from the server.
