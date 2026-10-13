# 05 — MVP Scope & Roadmap

## Guiding principle

**Start narrow, nail the experience, then widen.** One delightful path (GitHub → Node/Next.js/static → VPS → HTTPS domain) beats ten half-working ones.

## Should we focus on one language?

Yes, at first: **the JavaScript ecosystem + "bring your own Dockerfile"**.
- JS is your strength, so you'll debug users' issues fastest.
- It's the most common stack among the developers we're targeting.
- Dockerfile passthrough means Go, Python and Java users who already have a Dockerfile can still use us from day one.

## Should we start with AWS/GCP?

**No provider-specific integration in the MVP.** We treat every server the same: *an Ubuntu box we can SSH into*. An AWS EC2 instance, a GCP VM and a Hostinger VPS all work the same way. This covers both the AWS case and the VPS market (where the money is) with one implementation.
Provider APIs (e.g. "create a DigitalOcean / Hetzner / AWS server for me") come later as a convenience.

---

> Dated, task-level breakdown of each phase: [implementation/](implementation/README.md).

## Phase 0 — Foundations (1–2 weeks)
- [ ] Pick a name, register domain, create GitHub org
- [ ] Monorepo setup (pnpm + Turborepo): `web`, `api`, `worker`, `shared`, `db`
- [ ] Local dev with docker-compose (Postgres, Redis)
- [ ] CI with GitHub Actions: lint, typecheck, test
- [ ] **Spike (most important):** a plain script that SSHes into a test VPS, installs Docker + Traefik, clones a sample Next.js repo, builds it, and serves it on HTTPS. If this works, the rest is product around it.

## Phase 1 — MVP (6–10 weeks)
- [ ] Sign up / login (email + GitHub), email verification
- [ ] Connect GitHub App, list repos and branches
- [ ] Add server (generated key or pasted key), host key check, bootstrap job
- [ ] Create app: repo, branch, root directory, framework auto-detect + override
- [ ] Adapters: **static HTML, static SPA (React/Vue/Angular via Vite etc.), Node (Express/Fastify/NestJS), Next.js, Dockerfile**
- [ ] Env vars: table + paste `.env`, build vs runtime
- [ ] Deploy with **live logs**, deployment history, status
- [ ] Free platform subdomain with HTTPS
- [ ] Custom domain with DNS check + auto SSL
- [ ] Auto deploy on push (webhook)
- [ ] Rollback to previous deployment
- [ ] Friendly error messages for the top 10 failures

## Phase 2 — Widen (after first real users)
- [ ] Adapters: PHP / **Laravel**, Python (Django/FastAPI/Flask), Go, Java Spring Boot
- [ ] docker-compose support
- [ ] One-click databases (Postgres, MySQL, Redis, MongoDB) + backups
- [ ] Teams / organizations, roles
- [ ] Billing (Paystack / Flutterwave + Stripe), plans and limits
- [ ] Server monitoring: CPU, RAM, disk, container health, alerts
- [ ] Preview deployments for pull requests

## Phase 3 — Scale & differentiate
- [ ] Remote builders (build on our infra, push to registry) as a paid tier
- [ ] Go **agent** on servers (outbound connection to us, no inbound SSH needed)
- [ ] Provider integrations: create servers via Hetzner / DigitalOcean / AWS APIs
- [ ] GitLab / Bitbucket support
- [ ] Cron jobs, workers / queues, multiple servers + load balancing
- [ ] CLI tool

## Monetization ideas (to validate)
- **Free:** 1 server, 2 apps, platform subdomain
- **Pro:** monthly per user. Unlimited apps, custom domains, more servers, backups
- **Agency:** teams, many servers, client handover
- Local pricing in NGN, etc., to undercut USD-priced competitors

## Learning path for you along the way
1. Docker basics: images, containers, networks, volumes, multi-stage builds
2. Linux server basics: SSH, users, systemd, ufw, swap
3. DNS (A/CNAME records) and how Let's Encrypt validates domains
4. Traefik: routers, services, labels, cert resolvers
5. GitHub Apps: JWT auth, installation tokens, webhooks
6. BullMQ: jobs, retries, concurrency
7. Later: Go, for the agent
