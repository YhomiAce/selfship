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

- [x] **Deploy spike** (moved from Phase 0): [`tools/deploy-spike`](../../tools/deploy-spike/README.md) bootstraps a VPS and deploys static, Vite and Next.js apps over SSH with zero-downtime switches. Results: [`docs/spike-results.md`](../spike-results.md). Real Let's Encrypt certificates verified on `*.spike.selfship.dev`
- [x] **Envelope encryption**, [`packages/crypto`](../../packages/crypto/src/envelope.ts): AES-256-GCM data key per secret, wrapped by a master key from env. Key IDs allow rotation (`ENCRYPTION_PREVIOUS_KEYS`). Ciphertext is bound to its row and purpose (`server:<id>:ssh-key`), so it can't be copied to another server
- [x] Prisma: `Server` (connection, encrypted key, pinned host key, specs, tier, status, problems/warnings) and `ServerJob` (check/setup runs with saved log)
- [x] **Add server form** (`/dashboard/servers/new`)
  - Generate a key (default): we create an Ed25519 key pair; the server page shows the one-line command that adds our public key, then "I've added it, connect"
  - Paste a private key: validated (passphrase-protected keys rejected) and encrypted immediately
  - Password once: used **inside the API request** to install our key, never stored, logged or queued (Redis)
  - SSRF guard: private, loopback, link-local/metadata and CGNAT addresses are refused, re-checked on every connect (DNS can change). `ALLOW_PRIVATE_SERVER_HOSTS=true` for LAN VMs in development
- [x] SSH in [`packages/remote`](../../packages/remote/src/ssh.ts) (used by the worker): timeouts, streaming exec, host key pinning (trust on first use, refuse on mismatch)
- [x] **Pre-flight** ([`preflight.ts`](../../packages/remote/src/preflight.ts)): OS, arch, RAM, swap, disk, passwordless sudo, Docker version, and what is listening on 80/443 (names the program and gives the `systemctl` fix)
- [x] **Capability tier** from RAM: static-only (<850 MB reported), standard, recommended (≥1.8 GB). Thresholds sit below 1/2 GB because VPSes report a little less than nominal
- [x] **Setup job** ([`bootstrap.sh`](../../packages/remote/scripts/bootstrap.sh), idempotent): Docker ≥ 23, swap under 2 GB RAM, ufw (SSH port first), unattended-upgrades, Traefik `v3.7` (recreated only when its config changes). The `deployer` user is deferred (decision #46)
- [x] **Live logs over Server-Sent Events** (not Socket.IO, decision #44): the worker appends lines to a Redis Stream per job; the API streams it with resume (`Last-Event-ID`) and falls back to the saved log after the stream expires
- [x] UI: servers list with status badges; server page with the connect step, live log, findings, specs/tier/host key, "Check again", "Run/Re-run setup", history (replays old logs) and "Remove server" with the revoke command
- [x] Tests: crypto 14, remote 57, worker 21, API e2e 67 (17 for servers), web 32. Browser walkthrough against a real AWS server (2026-10-16)

**What you'll test**

- [ ] Add your VPS with each of the 3 options. Pre-flight shows correct specs
- [ ] Setup streams live and ends ✅ Ready. Running it again is safe
- [ ] Click "connect" before adding the key: the page explains, and still shows the command
- [ ] Change the server's host key (or point to another IP). Connection is refused with a clear warning
- [ ] DB inspection: private keys are ciphertext (`select "encryptedPrivateKey" from "Server"`), and a password used to add a server appears nowhere (DB, Redis, logs)
- [ ] Remove a server and run the shown command: our key is gone from `authorized_keys`

---

## M4 — Deploy engine

- [x] Prisma: `Deployment` (commit, trigger, status = stage, per-stage timings, failed stage, error summary, image/container, URL, cancel flag), `DeploymentLogChunk` (saved log), `EnvVar` (encrypted value, scope); `Project.serverId` and `healthCheckPath`
- [x] **Env vars** ([card](../../apps/web/src/components/env-vars/env-vars-card.tsx)): add, reveal, edit, change scope, delete; **Paste .env** with a live preview ([parser](../../packages/shared/src/env/dotenv.ts): comments, quotes, `export`, inline comments, multiline, CRLF, duplicates). Scopes: runtime, build, both. `NEXT_PUBLIC_*`, `VITE_*`, `REACT_APP_*`… are suggested as build-time. Values are envelope-encrypted, bound to project and name
- [x] **Pipeline** ([`AppDeployer`](../../packages/remote/src/deploy.ts), driven by the worker's [`DeploymentRunner`](../../apps/worker/src/deployments/deployment.runner.ts)): `queued → cloning → building → starting → health_check → switching → live` (or `failed` with the stage, or `cancelled`)
- [x] Concurrency: one active deployment per project (409, project row locked); builds per server limited by `SERVER_BUILD_CONCURRENCY` (default 1) with an atomic claim under a Postgres advisory lock; busy jobs wait 5 s and retry. **Cancel** kills the running step's process group on the server
- [x] Clone exactly the commit (resolved from the branch when the deployment is created) with the installation token sent over **stdin** only: never in a command line, file or `.git/config`. Sparse checkout for monorepo folders
- [x] Build-time variables as `--build-arg NAME`, runtime ones as `-e NAME`, both exported from root-only (`600`) files that are deleted right after (multiline values work; `--env-file` can't)
- [x] Health check over HTTP on the configurable path (any status below 500), crash detection, 120 s timeout. The old version keeps serving if anything fails before the switch
- [x] Zero-downtime switch (per-deployment Traefik router, priority, retry, settle). **Verified: 606/606 requests OK during a redeploy**
- [x] Keep the last 3 images and build folders per app; prune the build cache above 80 % disk
- [x] **Logs**: live over SSE (Redis Stream), saved to the DB in chunks every 2 s, **secret values and the GitHub token masked** before anything is written
- [x] Temporary URL per project: `https://<name>-<id>.<ip-with-dashes>.sslip.io` with a real Let's Encrypt certificate (custom domains in M5)
- [x] Deleting a project (or moving it to another server, after the first success there) removes the app's containers, images and files from the old server
- [x] UI: project page (live URL, Deploy, server + health path, deployment history, env vars), deployment page (stage timeline with timings, live log with ANSI colours, search, follow/pause, cancel, failure summary)

**What you'll test**

- [ ] Deploy your test repos. All go live at their sslip.io URL (verified 2026-10-16 with Yhomi/Portfolio, vanillawebprojects/breakout-game, Github-Finder)
- [ ] Add an env var, redeploy, and the app sees it. Paste a 10-line `.env` and it parses correctly
- [ ] Break a build on purpose. Deployment fails at "building" and the previous version stays live
- [ ] Cancel a deployment while it builds: it stops within seconds, the previous version stays live
- [ ] Secret values never show in logs (a build that echoes one shows `••••••`)
- [ ] Delete a project: its app disappears from the server

---

## M5 — Domains, SSL, auto-deploy, rollback, friendly errors

- [x] **Cloudflare DNS** ([`packages/cloudflare`](../../packages/cloudflare/src/client.ts)): A records for free subdomains, DNS only (not proxied) so Let's Encrypt reaches the server
- [x] **Free HTTPS subdomain** per project: `<name>.<PLATFORM_APPS_DOMAIN>` (or `<name>-<id>` if taken or reserved), created at the first deployment, moved when the project changes server (after the first success there), deleted with the project. The sslip.io URL stays as a fallback. **Verified live 2026-10-21:** `portfolio.selfship.app` got its DNS record and a Let's Encrypt certificate in 45 s; deleting the project removed the record.
- [x] **Custom domains**: add → exact DNS record shown → checked through public resolvers (explains missing records, wrong IPs, extra A records, stray AAAA, Cloudflare's orange cloud) → re-run of the live image with the new route → certificate confirmed with a TLS probe → ✅. Stuck certificates are explained from Traefik's log (rate limit, DNS, firewall, CAA). A worker job runs the checks every minute; "Check now" runs them immediately
- [x] **www ↔ apex redirect** (permanent, path and query kept)
- [x] **Auto-deploy on push** with a per-project switch: matching repo + branch + installation, newest push wins over waiting deployments, redeliveries and `[skip deploy]`/`[skip ci]` ignored
- [x] **Rollback** to any of the last 3 images, no rebuild (current runtime env vars). Plus **Redeploy this commit** (rebuild an older commit)
- [x] **Rule-based error explainer** ([`explain.ts`](../../packages/shared/src/deployments/explain.ts)): out of memory, JS heap, disk full, missing/outdated lockfile, ERESOLVE, missing script, private package, Node version, module not found (case-sensitivity), missing Dockerfile, wrong output folder, database unreachable, wrong port, EADDRINUSE, crash on start, Docker not running, SSH key removed, server unreachable, force-pushed commit, lost repo access, old webpack/OpenSSL, CRA warnings with CI=true

**Verified live (2026-10-19, test-2gb):** push webhook deployed in 38 s (redelivery and skip marker ignored); rollback live in 29 s with 576/576 requests OK during the switch; a custom domain and its www twin went from "added" to ✅ with Let's Encrypt certificates in 45 s; www → apex 301 kept path and query; wrong-IP domain explained; removing a domain dropped its route; the old-webpack failure got its hint.

**What you'll test**

- [x] Set the Cloudflare token, deploy: the project gets `https://<name>.selfship.app` with a valid certificate (verified 2026-10-21)
- [ ] Add your real domain. The UI guides you, then it turns ✅ with HTTPS
- [ ] Push a commit and it auto-deploys (needs the smee relay locally, see the GitHub App guide). Roll back and the old version is live within seconds
- [ ] Trigger an OOM / wrong port and see a human-readable explanation

---

## M6 — Build Doctor (AI) + Free Sandbox

Details: [08-ai-build-doctor.md](../08-ai-build-doctor.md), [09-free-tier-sandbox.md](../09-free-tier-sandbox.md)

**Build Doctor v1**

- [x] Worker [`BuildDoctorService`](../../apps/worker/src/build-doctor/build-doctor.service.ts): runs in the background after a failed deployment when no rule-based hint matched; users can also ask for it on any failure
- [x] Context: failed stage, last 300 log lines (redacted again with secret patterns, [`redact.ts`](../../apps/worker/src/build-doctor/redact.ts)), project type and settings, generated Dockerfile, `package.json`, file tree (depth 2, read from GitHub at the failed commit), env var **names only**, server specs, the rule hint if any
- [x] Claude (`claude-opus-5-5`, `BUILD_DOCTOR_MODEL`) with structured output validated by the shared zod `DiagnosisSchema`; stable cached system prompt that treats logs as data; refusals retried server-side on Anthropic's recommended fallback (`fallbacks: "default"`); `refusal`/`max_tokens` handled; token usage stored per diagnosis
- [x] Safe auto-remediation from an allowlist: `add_swap`, `prune_docker`, `retry` only for server/platform/network problems, not at low confidence, once per deployment chain (the retry is marked and never retried again). Settings fixes (`set_port`, `set_node_version`, `set_*_command`, `set_output_directory`) need a click and are validated exactly like the settings form
- [x] Cache by error fingerprint (per project, 30 days); daily limit per user (`BUILD_DOCTOR_DAILY_LIMIT`, default 10); off cleanly without `ANTHROPIC_API_KEY`; per-project switch
- [x] UI: Build Doctor panel on failed deployments (summary, root cause, evidence, numbered fix steps, diff view of a suggested patch, "Apply fix" → "Deploy again", 👍/👎), privacy notice, project switch

**Free sandbox**

- [x] `Server.isPlatformSandbox`, set with `pnpm --filter @selfship/api sandbox-server <id> on|off` (admin)
- [x] Container limits 256 MB (no swap) / 0.25 CPU / 256 processes, all capabilities dropped except those nginx/node need, `no-new-privileges`; a Docker network per app (Traefik joins each); outbound mail ports blocked; request rate limit (50/s, burst 100); 10-minute build timeout
- [x] Policy: verified email, one sandbox app per user, static/SPA/Node only, free subdomain only (no custom domains), 7 days, extendable once; a project's time isn't restarted; an hourly job removes expired apps (the project stays, ready to move to the user's server)
- [x] Onboarding: "Deploy to" offers "Try it on the free sandbox" or "Use your own server"; a banner shows the remaining days, Extend, and the way to your own server
- [ ] Sleep after inactivity: deferred (needs traffic data from Traefik; Phase 2)

**Verified live (2026-10-21, test-2gb as the sandbox server):** sandbox deploy in 31 s at `portfolio.selfship.app`; limits and capabilities as configured; the app could not reach another app's container or open SMTP port 587 while normal HTTPS egress worked; forced expiry removed the app and its network and blocked re-joining. **Build Doctor is unit/e2e tested with a fake model; a live run needs `ANTHROPIC_API_KEY`.**

**What you'll test**

- [ ] Add `ANTHROPIC_API_KEY` to `.env`. Break a repo in 3 different ways (syntax error, missing dependency, wrong start command). Build Doctor explains each correctly with fix steps
- [ ] Deploy to the sandbox without owning a server, in under 5 minutes from signup (needs a sandbox server: add one, then `pnpm --filter @selfship/api sandbox-server <id> on`)
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
