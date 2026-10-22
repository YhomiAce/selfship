# Self-hosting Selfship

Run the whole Selfship platform (dashboard, API, worker, database) on your own machine with Docker Compose. Your apps still deploy to whatever servers you add in the dashboard; this machine only runs Selfship itself.

## What you need

- A Linux machine with **Docker** (with Compose v2) and at least **2 GB RAM** and 10 GB of disk. It can be one of the servers you'll deploy apps to, but a separate small VPS is cleaner.
- A **domain** for the dashboard, e.g. `selfship.example.com`, with an **A record** pointing to this machine.
- **Ports 80 and 443** open (Caddy gets the HTTPS certificate from Let's Encrypt automatically).
- An **SMTP** account for sign-up and password-reset emails.
- A **GitHub App** (to connect repositories): [GitHub App setup](guides/github-app-setup.md).

## Install

```bash
git clone https://github.com/<you>/selfship.git && cd selfship
cp .env.selfhost.example .env.selfhost
```

Edit `.env.selfhost`. At minimum:

| Setting                                 | How to get it                                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SELFSHIP_DOMAIN`                       | Your dashboard domain (no `https://`)                                                                                                                   |
| `POSTGRES_PASSWORD`                     | `openssl rand -hex 24`                                                                                                                                  |
| `ENCRYPTION_KEY`                        | `openssl rand -base64 32`. **Back it up**: without it, stored SSH keys and env vars are unreadable                                                      |
| `SMTP_*`, `MAIL_FROM`                   | Your email provider's SMTP settings                                                                                                                     |
| `GITHUB_APP_*`, `GITHUB_WEBHOOK_SECRET` | From your GitHub App. Its webhook URL is `https://<SELFSHIP_DOMAIN>/api/webhooks/github`, its callback URL `https://<SELFSHIP_DOMAIN>/api/github/setup` |

Then start everything:

```bash
docker compose --env-file .env.selfhost up -d --build
```

The first build takes a few minutes. Compose then:

1. starts Postgres and Redis (data in Docker volumes)
2. runs the database migrations once (`migrate`)
3. starts the API, the worker and the dashboard
4. starts Caddy, which gets a certificate for your domain

Open `https://<SELFSHIP_DOMAIN>` and sign up. The first account is a normal user; there's no separate admin yet.

## Optional features

Set these in `.env.selfhost` and run `docker compose --env-file .env.selfhost up -d` again.

| Feature                                        | Settings                                                                                                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Free subdomains `<project>.<your-apps-domain>` | `PLATFORM_APPS_DOMAIN`, `CLOUDFLARE_API_TOKEN` ("Edit zone DNS" on that zone), `CLOUDFLARE_ZONE_ID`                                       |
| Build Doctor (AI diagnosis of failed builds)   | `ANTHROPIC_API_KEY` (a [Claude Console](https://console.anthropic.com) API key)                                                           |
| "Sign in with GitHub"                          | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` (an OAuth app: [guide](guides/github-oauth-setup.md))                                          |
| Free sandbox for your users                    | Add a server in the dashboard, then `docker compose --env-file .env.selfhost exec api node dist/scripts/sandbox-server.js <server-id> on` |

Without them, apps get a working `https://<name>.<ip>.sslip.io` address and failed builds still get rule-based explanations.

## Operating it

```bash
# Status and logs
docker compose --env-file .env.selfhost ps
docker compose --env-file .env.selfhost logs -f worker      # deployments, server jobs
docker compose --env-file .env.selfhost logs -f api

# Update to a new version
git pull
docker compose --env-file .env.selfhost up -d --build       # migrations run automatically

# Back up the database (do this daily, e.g. from cron)
docker compose --env-file .env.selfhost exec -T postgres pg_dump -U selfship selfship | gzip > selfship-$(date +%F).sql.gz

# Restore
gunzip -c selfship-2026-10-22.sql.gz | docker compose --env-file .env.selfhost exec -T postgres psql -U selfship selfship
```

**Monitoring:** point an uptime checker (UptimeRobot, Better Stack…) at `https://<SELFSHIP_DOMAIN>/api/health`; it answers `200` while the API, Postgres and Redis are up, and `503` when one of them is down. For error reports, set `SENTRY_DSN`.

Back up `.env.selfhost` too (it holds `ENCRYPTION_KEY`), somewhere other than this machine.

## How it fits together

```
Internet ─► Caddy :443 ─► web (Next.js) ─► /api/* ─► api (NestJS) ─► Postgres
                                                        │
                                                        └─► Redis ◄── worker ── SSH ──► your servers
```

Only Caddy is exposed. GitHub webhooks also arrive through the dashboard's `/api` proxy. The worker opens SSH connections to the servers you add and runs every deployment there; see the [deployment walkthrough](walkthroughs/m4-m6-deployments-and-logs.md).

The images are built from the repository's [`Dockerfile`](../Dockerfile) (targets `api`, `worker`, `web`, `migrate`); [`docker-compose.yml`](../docker-compose.yml) wires them together.

## Troubleshooting

| Symptom                              | Cause / fix                                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Caddy logs "no certificate"          | The A record doesn't point here yet, or ports 80/443 are blocked by a firewall.                                                            |
| "Request blocked: unexpected origin" | You're opening the dashboard on another address than `SELFSHIP_DOMAIN`. Use exactly `https://<SELFSHIP_DOMAIN>`.                           |
| Sign-up works but no email arrives   | Check `SMTP_*` and the worker logs (emails are sent by the worker).                                                                        |
| Worker can't reach GitHub or servers | The machine's DNS or outbound network is blocked for Docker containers. Test with `docker run --rm busybox nslookup github.com`.           |
| `migrate` exited with an error       | `docker compose --env-file .env.selfhost logs migrate`; usually a wrong `POSTGRES_PASSWORD` after the volume was created with another one. |
