# Phase 2 — Widen

**Dates:** 2027-02-15 → 2027-05-30 (≈ 7 milestones × 2 weeks)
**Goal:** Turn the beta into a product people pay for, supporting the major languages.

Order follows value. Beta feedback can re-order it.

| Milestone | Dates | Theme |
|-----------|-------|-------|
| M8 | Feb 15 → Feb 28 | Billing (per-app pricing, test mode) |
| M9 | Mar 1 → Mar 14 | Adapters: PHP + Laravel, Python |
| M10 | Mar 15 → Mar 28 | Adapters: Go, Java Spring Boot; docker-compose |
| M11 | Mar 29 → Apr 11 | One-click databases + backups |
| M12 | Apr 12 → Apr 25 | Teams & roles |
| M13 | Apr 26 → May 9 | Monitoring, alerts, PR preview deployments |
| M14 | May 10 → May 30 | Build Doctor v2 (agentic) + buffer |

---

## M8 — Billing

- [ ] `PaymentProvider` interface (`createCheckout`, `createPortalSession`, `handleWebhook`, `cancel`) so we can swap providers
- [ ] First implementation: **Stripe in test mode** (best test tooling)
- [ ] **Per-app pricing** (draft numbers, to validate):
  - **Free**: 1 sandbox app (expires) **or** 1 app on your own server, platform subdomain only
  - **Per app**: e.g. $3/app/month with custom domains, Build Doctor, rollbacks, unlimited deploys
  - Volume discount later (agency use case)
- [ ] Entitlements service: plan limits enforced in API (`canCreateApp`, `canUseCustomDomain`, `buildDoctorQuota`)
- [ ] UI: pricing page, billing settings, upgrade prompts at limits
- [ ] **Before going live:** choose the live provider. Stripe needs a business in a supported country. Alternatives: a merchant of record such as Paddle or Lemon Squeezy (they handle global sales tax, which is useful for a solo founder) or Paystack/Flutterwave for African cards. The interface keeps this a config change.

## M9–M10 — More languages

Each adapter: detection, defaults, Dockerfile template, fixture repos, integration test on a real VPS, docs page.

- [ ] **PHP** (plain, Apache/nginx + php-fpm), **Laravel** (composer, `artisan migrate` as release command, queue worker + scheduler as extra processes)
- [ ] **Python**: Django, FastAPI, Flask (gunicorn/uvicorn), pip / poetry / uv
- [ ] **Go**: multi-stage build → tiny image
- [ ] **Java Spring Boot**: Maven/Gradle, JVM memory flags tuned for small VPSes
- [ ] **Release commands** (run once per deploy before switch, e.g. migrations)
- [ ] **docker-compose** projects: deploy a compose file, Traefik labels injected for the public service
- [ ] Evaluate **Railpack** as a generic fallback adapter

## M11 — Databases

- [ ] One-click Postgres, MySQL/MariaDB, Redis, MongoDB on a server: persistent volume, generated credentials, internal network only (not public by default)
- [ ] "Link to project" injects `DATABASE_URL` etc. as runtime env
- [ ] Scheduled backups (`pg_dump` / `mysqldump`) to S3-compatible storage (user-provided or ours on paid plan), plus restore

## M12 — Teams

- [ ] `Organization`, `Membership` (owner/admin/developer/viewer), invites
- [ ] All resources owned by an org (personal org per user, migrated)
- [ ] Agency feature: transfer a project/server to a client's org

## M13 — Monitoring & previews

- [ ] Server metrics via SSH polling (CPU, RAM, disk, container status) with charts
- [ ] Alerts (email, later Slack/Discord): app down, disk > 90%, SSL expiring, deploy failed
- [ ] **PR preview deployments**: deploy each PR to `pr-<n>-<project>.<platform-domain>`, comment URL on the PR, clean up on close

## M14 — Build Doctor v2

- [ ] Agentic mode: Claude can call read-only tools (`read_repo_file`, `list_dir`, `get_previous_successful_build_log`) to investigate deeper
- [ ] "Open fix PR": with the user's explicit opt-in (needs GitHub App Contents **write**), commit the suggested patch to a new branch and open a PR. Never push to the deployed branch
- [ ] Evaluation set from real 👍/👎 feedback to measure and improve accuracy
