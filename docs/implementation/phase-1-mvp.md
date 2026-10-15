# Phase 1 — MVP (Public Beta)

**Dates:** 2026-10-27 → 2027-02-14 (7 milestones × 2 weeks, plus a holiday buffer)
**Goal:** A developer signs up, connects GitHub, adds a VPS (or uses our free sandbox), deploys a static / SPA / Node / Next.js / Dockerfile app with env vars, gets HTTPS on a free subdomain or their own domain, auto-deploys on push, can roll back, and gets an AI explanation when a build fails.

| Milestone | Dates           | Theme                                                |
| --------- | --------------- | ---------------------------------------------------- |
| M1        | Oct 27 → Nov 9  | Auth & accounts                                      |
| M2        | Nov 10 → Nov 23 | GitHub App, projects, framework detection            |
| M3        | Nov 24 → Dec 7  | Servers: keys, pre-flight, bootstrap                 |
| M4        | Dec 8 → Dec 21  | Deploy engine, env vars, live logs                   |
| —         | Dec 22 → Jan 4  | **Holiday buffer** (catch-up / rest)                 |
| M5        | Jan 5 → Jan 18  | Domains, SSL, auto-deploy, rollback, friendly errors |
| M6        | Jan 19 → Feb 1  | Build Doctor (AI) + free sandbox                     |
| M7        | Feb 2 → Feb 14  | Hardening, self-host, docs, launch                   |

---

## M1 — Auth & accounts ✅ (implemented 2026-10-14, awaiting founder review)

**Backend (`apps/api`)**

- [x] Prisma: `User`, `Session`, `VerificationToken` (one table, `purpose` = email verification / password reset), `OAuthAccount`
- [x] `AuthModule`: register, login, logout, me, verify email, resend verification, forgot/reset password
- [x] Passwords hashed with argon2id. Random session token in an httpOnly + SameSite=Lax cookie (`__Host-` prefix + Secure in production); only its SHA-256 hash is stored, so sessions are revocable. Sliding 30-day expiry
- [x] GitHub OAuth **login** (links to an existing account by verified email, with pre-registration hijack protection)
- [x] Rate limiting (`@nestjs/throttler`) on auth routes. Same error and same timing for "unknown email" and "wrong password"
- [x] Emails: API queues `email:send` jobs, worker renders templates and sends over SMTP (Mailpit in dev)
- [x] CSRF: SameSite=Lax cookies + global `OriginGuard` (state-changing requests from a foreign `Origin` get 403)
- [x] Global `AuthGuard`: every route requires a session unless marked `@Public()`

**Frontend (`apps/web`)**

- [x] Pages: sign up, login, verify email, forgot/reset password, dashboard shell (sidebar: Projects, Servers, Settings)
- [x] Form validation with the **same zod schemas** as the API (from `packages/shared`), server field errors mapped onto inputs
- [x] Auth-guarded routes (`proxy.ts` optimistic redirect + client session check), toasts, loading/empty states, unverified-email banner with resend

**Tests:** 35 API unit tests, 13 API integration tests (full auth flow against Postgres), 8 worker tests, 10 shared-schema tests, plus a headless-Chrome walkthrough of sign-up → dashboard → logout → login error → forgot password → verify link (run manually)

**What you'll test**

- [ ] Sign up → email shows in Mailpit (http://localhost:8026) → click link → "Email confirmed" → dashboard banner gone
- [ ] Log in with GitHub (needs an OAuth App, see [guide](../guides/github-oauth-setup.md))
- [ ] Wrong password 11× within a minute gets rate-limited. Password reset works end to end and signs out other sessions

**Known limitations (tracked for later)**

- Rate-limit counters are in memory (per API process). Move to Redis storage before running more than one API instance
- Expired sessions are deleted lazily on use. Add a scheduled cleanup job with the first cron work (M3+)
- In production, a trusted reverse proxy must set `X-Forwarded-For` (we trust private-network proxies by default via `TRUST_PROXY`)
- Sign-up reveals whether an email is registered (409). Accepted for UX; login and password reset do not reveal it

---

## M2 — GitHub App, projects, detection ✅ (implemented 2026-10-15, awaiting founder review)

- [x] Guide: [`docs/guides/github-app-setup.md`](../guides/github-app-setup.md) (Contents read, Metadata read; push events; installation events are automatic)
- [x] `GithubModule`: app JWT, installation tokens (in memory, refreshed before the 1 h expiry, never persisted), install redirect + setup callback, `POST /webhooks/github` with **signature verification**, installation created/deleted/suspend/unsuspend and repository-access events
- [x] **Ownership check**: the `installation_id` in GitHub's redirect is only trusted if GitHub lists it for the user who authorised (requires "Request user authorization during installation")
- [x] List repos (searchable, paginated, cached 5 min in Redis, cleared by webhooks) and branches (default first)
- [x] `packages/adapters`: `static`, `spa` (Vite/CRA/Angular/Vue CLI/Astro/Parcel/Next static export), `node`, `nextjs`, `dockerfile`. Detection, suggested settings, generated Dockerfile + `.dockerignore`, fixture-based tests
- [x] Detection **before deploy** through the GitHub API (no clone): package manager, Node version, build/start commands, output dir, port
- [x] Monorepo support: "root directory" field, verified on GitHub
- [x] Prisma: `GithubInstallation`, `GithubInstallationMember`, `Project`
- [x] UI: "New project" wizard (connect GitHub → pick account/repo → review detected settings → create), projects grid, project page with editable settings and delete
- [x] Extra: projects re-link automatically when an account reinstalls the app (GitHub issues a new installation ID)
- [x] Extra: `pnpm mock:github`, a local fake GitHub for demos and UI testing

**Tests:** 36 adapter tests, 20 GitHub client tests, 62 shared-schema tests, 64 API unit tests, 46 API integration tests (connect, ownership, repos, detection, projects, webhooks, reinstall), 32 web unit tests, plus a headless-Chrome walkthrough against the mock GitHub (run manually)

**What you'll test**

- [ ] Register the GitHub App ([guide](../guides/github-app-setup.md)), install it on selected repos. They appear in the wizard
- [ ] Create projects from a Next.js repo, a Vite React repo and a plain HTML repo. Each is detected correctly
- [ ] Uninstall the app on GitHub. The UI shows "GitHub access removed". **Reconnect GitHub** restores it
- [ ] (Optional, no GitHub needed) `pnpm mock:github` demo

**Notes for later milestones**

- Generated Dockerfiles for static/SPA use a BuildKit heredoc, so M3's bootstrap must install **Docker ≥ 23** (BuildKit default)
- The worker will reuse `packages/github` to clone with installation tokens (M4)
- "Sign in with GitHub" still uses the separate OAuth App (decision #33); moving it onto the GitHub App is optional

---

## M3 — Servers

- [ ] **Deploy spike first** (moved from Phase 0): `make up` in `infra/aws/test-servers`, then a standalone script that bootstraps the VPS and deploys a static + Next.js app over SSH. Record results in `docs/spike-results.md`, then `make down`
- [ ] `CryptoModule`: envelope encryption (AES-256-GCM data keys, master key from env), with key-version field for future rotation
- [ ] Prisma: `Server` (name, host, port, sshUser, encryptedPrivateKey, publicKey, hostKeyFingerprint, os, arch, ramMb, diskGb, status, capabilityTier)
- [ ] **Add server wizard**
  - Option A (default): we generate an Ed25519 keypair. UI shows a one-line command to append our public key
  - Option B: paste private key (encrypted immediately)
  - Option C: root password used **once** in memory to install our key, never stored
- [ ] `SshService` (in worker): connect with timeouts, exec with streaming, host key pinning (TOFU, refuse on mismatch)
- [ ] **Pre-flight job** checks OS (Ubuntu 22.04/24.04, Debian 12/13), arch (x86_64/arm64), RAM, disk, sudo, ports 80/443, existing web servers (nginx/apache using port 80, which we warn about and offer to handle)
- [ ] **Capability tier** from specs: `static-only` (<1 GB), `standard` (1–2 GB), `recommended` (≥2 GB). See [03](../03-deployment-engine.md#server-requirements)
- [ ] **Bootstrap job** (idempotent): Docker, `deployer` user, Traefik, ufw, swap, unattended-upgrades. Live log streaming
- [ ] Real-time channel: Socket.IO gateway with auth, subscriptions per server/deployment room, worker publishes via Redis
- [ ] UI: servers list with status badges, server detail (specs, tier, bootstrap logs, "re-run bootstrap", "remove server" + revoke instructions)

**What you'll test**

- [ ] Add your VPS with each of the 3 options. Pre-flight shows correct specs
- [ ] Bootstrap streams live and ends ✅ Ready. Running it again is safe
- [ ] Change the server's host key (or point to another IP). Connection is refused with a clear warning
- [ ] DB inspection: private keys are ciphertext

---

## M4 — Deploy engine

- [ ] Prisma: `Deployment` (projectId, serverId, commitSha, commitMessage, trigger, status, stages[], imageTag, startedAt, finishedAt, errorSummary), `EnvVar` (key, encryptedValue, scope: build|runtime)
- [ ] **Env vars**: table UI (add/edit/delete, reveal), "Paste .env" parser (comments, quotes, `export`, multiline), build vs runtime scope, `NEXT_PUBLIC_*` / `VITE_*` auto-suggested as build-time
- [ ] **Deployment pipeline** in worker, as a series of explicit stages so we can show progress and pinpoint failures:
      `queued → cloning → building → starting → health_check → switching → live` (or `failed` at any stage)
- [ ] Concurrency: one active deployment per project, a configurable limit per server. Cancel button
- [ ] Clone with installation token (token never written to disk or logs)
- [ ] Build args for build-time env vars. Runtime env file `chmod 600`
- [ ] Health check: HTTP on the app port (configurable path), timeout + retries
- [ ] Zero-downtime switch via Traefik. If health fails, keep the old container running
- [ ] Image retention: keep the last 3 per project. Prune build cache when disk is above 80%
- [ ] **Log handling**: stream to UI live, persist to DB (chunked), **mask secret values**
- [ ] UI: project page (status, URL, deploy button, deployment history), deployment detail with stage timeline + live log viewer (ANSI colors, auto-scroll, search)

**What you'll test**

- [ ] Deploy each of your 4 test repos. All go live (temporary URL: `http://<ip>:<port>` or the Traefik default host until M5)
- [ ] Add an env var, redeploy, and the app sees it. Paste a 10-line `.env` and it parses correctly
- [ ] Break a build on purpose. Deployment fails at "building" and the previous version stays live
- [ ] Secret values never show in logs

---

## M5 — Domains, SSL, auto-deploy, rollback, friendly errors

- [ ] `CloudflareModule`: create/delete DNS records for `<project>-<rand>.<platform-domain>` pointing to the server IP
- [ ] Every project gets a **free HTTPS subdomain** automatically
- [ ] Custom domains: add domain, show the exact DNS record to create, poll DNS (verify A/AAAA matches server IP), attach to Traefik router, track SSL status
- [ ] `www` ↔ apex redirect option
- [ ] **Auto-deploy on push** (webhook → matching projects/branch → enqueue), with a toggle per project
- [ ] **Rollback**: redeploy a previous image tag instantly (no rebuild)
- [ ] **Rule-based error explainer** (no AI yet): pattern table for OOM/exit 137, port not listening, missing lockfile, `npm ERR! ERESOLVE`, missing build script, disk full, DNS mismatch, Let's Encrypt rate limit, SSH auth failure, Docker not running

**What you'll test**

- [ ] New project gets `https://xyz.<platform-domain>` with a valid cert
- [ ] Add your real domain. The UI guides you, then it turns ✅ with HTTPS
- [ ] Push a commit and it auto-deploys. Roll back and the old version is live within seconds
- [ ] Trigger an OOM / wrong port and see a human-readable explanation

---

## M6 — Build Doctor (AI) + Free Sandbox

Details: [08-ai-build-doctor.md](../08-ai-build-doctor.md), [09-free-tier-sandbox.md](../09-free-tier-sandbox.md)

**Build Doctor v1**

- [ ] `BuildDoctorModule`: runs after a failed deployment when no deterministic rule matched (or to enrich a rule match)
- [ ] Context builder: failed stage, redacted log tail, adapter, generated Dockerfile, `package.json`, file tree (depth 2), env var **keys only**, server specs
- [ ] Call Claude with a zod structured-output schema → `Diagnosis`
- [ ] Safe auto-remediation for **platform/server** issues from an allowlist (add swap, prune images, retry once). Config fixes need a user click
- [ ] Cache by error fingerprint. Per-user daily quota. Feature turns off cleanly if no API key is set (self-hosters)
- [ ] UI: "Build Doctor" panel on failed deployments: summary, root cause, numbered fix steps, suggested code change (diff view), "Apply fix" for safe actions, 👍/👎 feedback

**Free sandbox**

- [ ] Platform-owned `Server` records flagged `isPlatformSandbox`
- [ ] Container limits (memory/CPU/pids), no privileged, read-only root FS where possible, egress rate limits
- [ ] Sandbox policy: 1 app per verified user, static + Node/SPA (no Next.js if too heavy, decided from spike data), expires after 7 days, sleeps after inactivity
- [ ] Onboarding offers: "Deploy to free sandbox" or "Connect your own server"

**What you'll test**

- [ ] Break a repo in 3 different ways (syntax error, missing dependency, wrong start command). Build Doctor explains each correctly with fix steps
- [ ] Deploy to the sandbox without owning a server, in under 5 minutes from signup
- [ ] Sandbox app gets limited when it exceeds memory, and expires on schedule

---

## M7 — Hardening & launch

- [ ] Audit log (server added/removed, secret revealed, deploy, domain changes) + UI
- [ ] 2FA (TOTP) + recovery codes
- [ ] Security review pass ([04](../04-security.md) checklist), dependency audit, run `/security-review`
- [ ] **Self-host** package: `docker-compose.yml` for the whole platform, with an install guide (open-source promise)
- [ ] Production deploy of the platform itself (we deploy ourselves with our own engine if possible), backups of our Postgres
- [ ] Error tracking (Sentry, free tier) + uptime monitoring
- [ ] Public docs site (getting started, supported frameworks, server requirements, troubleshooting)
- [ ] Landing page + waitlist/feedback link
- [ ] Terms of service + privacy policy (AI data sharing disclosure included)

**Launch checklist**

- [ ] 5 friends/devs onboard without your help and deploy successfully
- [ ] Post on X/Twitter, Reddit (r/selfhosted, r/webdev), Hacker News "Show HN", dev communities
