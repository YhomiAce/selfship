# Selfship dev environment (`dev.selfship.dev`)

Every push to `main`, including merged pull requests, is checked, built and deployed here automatically. A `prod` branch and environment will follow the same pattern later.

```
push to main ─► GitHub Actions: checks (ci.yml) ─► build 4 images ─► ghcr.io/yhomiace/selfship-{api,worker,web,migrate}:<sha>
                                                                       │
                     ssh deploy@dev.selfship.dev deploy <sha> ◄────────┘
                                │   (the deploy key can run nothing else)
                                ▼
          EC2 t3.micro: selfship-deploy → compose pull → migrate → api/worker/web → health check
                        (rolls back to the previous commit if the new one is unhealthy)
```

| Piece                       | Where                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| Server, firewall, DNS, keys | this folder (Terraform)                                                                           |
| Workflows                   | `.github/workflows/ci.yml` (PR checks; reusable), `.github/workflows/deploy-dev.yml` (main → dev) |
| What runs on the server     | `deploy/compose.yml` (prebuilt images), `deploy/Caddyfile` (HTTPS)                                |
| Deploy script on the server | `deploy/server/selfship-deploy`                                                                   |
| Secrets                     | `dev.env` on your machine (gitignored) → `/opt/selfship/.env` on the server via `make env-push`   |

## Why it's built this way

- **The account's organization policy (SCP) blocks** GitHub OIDC providers, SSM Run Command and Parameter Store. That rules out keyless AWS deploys and AWS-hosted secrets.
- **So CI deploys over SSH with a restricted key.** In `authorized_keys`, the deploy user's key is limited to `command="…selfship-deploy",restrict`. The only thing CI can do is deploy a commit of this repo.
- **Port 22 is open to all,** because GitHub's runners have no fixed IPs. sshd lets the `ubuntu` admin in only from `admin_cidrs`, password login is off, and fail2ban is on.
- **No AWS credentials in GitHub. No secrets in the repo, in CI, or in Terraform.** The Terraform state does hold the generated SSH keys, so keep it local.
- **Small and cheap.** The stack uses ≈400 MB of RAM (measured), so a **t3.micro** (1 GB + 2 GB swap) runs it. Images are built in CI, never on the server.
- **No Elastic IP.** One bills while the server is stopped (that's what cost money on the old test servers). The public IP changes after a stop/start, and `make start` updates the DNS record.

**Cost (eu-north-1):**

|                       | Server | Disk (25 GB) | Public IPv4 | Total              |
| --------------------- | ------ | ------------ | ----------- | ------------------ |
| running               | $7.88  | $2.09        | $3.65       | **≈ $13.60/month** |
| stopped (`make stop`) | —      | $2.09        | —           | **≈ $2.10/month**  |

## First-time setup

You need:

- Terraform, and the AWS `selfship` profile
- `gh`, logged in as `YhomiAce`
- a Cloudflare API token with **Zone → DNS → Edit** on `selfship.dev`

```bash
cd infra/aws/platform-dev
cp terraform.tfvars.example terraform.tfvars    # set cloudflare_zone_id (and admin_cidrs if your ISP range changed)
export CLOUDFLARE_API_TOKEN=...                 # not saved anywhere
make init
make up             # server + dev.selfship.dev DNS record (≈1 min)
make ready          # repeat until "ready" (≈3 min: Docker, swap, deploy user)

make env-init       # creates dev.env with a generated Postgres password and ENCRYPTION_KEY
$EDITOR dev.env     # optional now: SMTP, GitHub App ("Selfship Dev"), Cloudflare, Anthropic, Sentry
make env-push       # uploads it to the server

make github-env     # GitHub environment "dev": deploy key, host, pinned host key; deploys from main only
```

Then push to `main` (or run **Actions → Deploy dev → Run workflow**). The first deploy pulls the images and Caddy gets the HTTPS certificate. Open https://dev.selfship.dev.

**Back up `ENCRYPTION_KEY`** from `dev.env` somewhere safe: stored SSH keys and env vars can't be decrypted without it.

### GitHub App for dev

Create a separate app, e.g. "Selfship Dev" ([guide](../../../docs/guides/github-app-setup.md)):

- webhook URL: `https://dev.selfship.dev/api/webhooks/github`
- callback / setup URL: `https://dev.selfship.dev/api/github/setup`

Put its values in `dev.env`. `GITHUB_APP_PRIVATE_KEY` must be on **one line** with `\n` for the line breaks (`awk 'NF {printf "%s\\n", $0}' key.pem`). Then run `make env-push`.

### Images on ghcr.io

The first push creates the four packages under your GitHub account. They should be **public**, like the repo, so the server can pull them without credentials. If `make status` or the deploy log shows `denied` / `unauthorized` when pulling, open each package at https://github.com/YhomiAce?tab=packages → **Package settings → Change visibility → Public**. This is needed once per package.

## Everyday commands

```bash
make status                 # deployed commit + containers
make logs S=api             # follow logs (api | worker | web | migrate | caddy | postgres | redis)
make deploy SHA=<sha>       # deploy or roll back to any commit that has images
make env-push               # after editing dev.env: upload + restart the running version
make ssh                    # admin shell (ubuntu)
make stop / make start      # pause (≈ $2/month) / resume (DNS is updated)
make backup / make backups  # dump the database now / download the newest dump (kept 7 days on the server, nightly at 03:15 UTC)
make server-update          # after changing deploy/server/selfship-deploy
make down                   # destroy everything, database included
```

## How a deploy works

What `selfship-deploy deploy <sha>` does on the server:

1. **Takes a lock:** one deploy at a time. GitHub also queues runs (`concurrency: deploy-dev`).
2. **Fetches config:** downloads `deploy/compose.yml` and `deploy/Caddyfile` at that commit from GitHub.
3. **Pulls and starts:** pulls `ghcr.io/yhomiace/selfship-*:<sha>`, then `docker compose up -d`. `migrate` runs `prisma migrate deploy` before api, worker and web start.
4. **Waits for health:** up to 5 min for the API to report healthy and the migration to exit 0.
5. **On failure, rolls back:** restores the previous commit's config and images, and the job fails. Database migrations aren't rolled back, so keep migrations backward compatible: add first, remove later.

The workflow then checks `https://dev.selfship.dev/api/health` from outside.

## Troubleshooting

| Symptom                                           | Fix                                                                                                                                                                                                                                                               |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Permission denied (publickey)` in the deploy job | Run `make github-env` again (the server was recreated, so it has a new deploy key).                                                                                                                                                                               |
| `Host key verification failed`                    | Same: `make github-env` refreshes the pinned host key.                                                                                                                                                                                                            |
| Deploy pulls fail with `denied`                   | Make the ghcr.io packages public (see above).                                                                                                                                                                                                                     |
| `.env is missing`                                 | `make env-init` (first time), then `make env-push`.                                                                                                                                                                                                               |
| Site down after `make start`                      | DNS is updated by the second apply. Wait up to 60 s (TTL), then check `make status`.                                                                                                                                                                              |
| Can't SSH as ubuntu                               | Your IP left `admin_cidrs`. Update `terraform.tfvars`, then run `make up` and `make server-update`. sshd's `AllowUsers` comes from cloud-init: on an existing server, edit `/etc/ssh/sshd_config.d/10-selfship.conf` from the AWS console (EC2 Instance Connect). |
